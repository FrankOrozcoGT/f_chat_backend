import { Injectable, Logger, ConflictException, ForbiddenException, BadGatewayException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { InternalChannelReviewRepository } from './repositories/internal-channel-review.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { FlowIntentRepository } from './repositories/flow-intent.repository';
import { FlowGeneratorNode, FlowGeneratorOutput } from './langgraph/nodes/flow-generator.node';
import { DiagramConsolidatorNode } from './langgraph/nodes/diagram-consolidator.node';
import { IntentClassifierNode } from './langgraph/nodes/intent-classifier.node';
import { IntentRepository } from '@modules/nodes/repositories/intent.repository';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { FlowVersionRepository } from '@modules/nodes/repositories/flow-version.repository';
import { createHash } from 'crypto';

@Injectable()
export class BatchAnalysisService {
  private readonly logger = new Logger(BatchAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: ConversationAnalysisService,
    private readonly clientLabelRepo: ClientLabelRepository,
    private readonly internalChannelReviewRepo: InternalChannelReviewRepository,
    private readonly conversationAnalysisRepo: ConversationAnalysisRepository,
    private readonly flowIntentRepo: FlowIntentRepository,
    private readonly flowGeneratorNode: FlowGeneratorNode,
    private readonly diagramConsolidatorNode: DiagramConsolidatorNode,
    private readonly intentClassifierNode: IntentClassifierNode,
    private readonly intentRepo: IntentRepository,
    private readonly nodeRepo: NodeRepository,
    private readonly flowVersionRepo: FlowVersionRepository,
  ) {}

  async runBatch(
    tenantId: string,
    channelCount: number,
    messageLimit: number,
  ): Promise<{ analyzed: number; internalsDetected: number; totalCostUsd: number; intents: { intent: string; count: number }[]; internals: { conversationId: string; clientId: string | null; groupJid: string | null; internalPurpose: string | null }[] }> {
    const conversations = await this.getActiveConversations(tenantId, channelCount);

    let analyzed = 0;
    let internalsDetected = 0;
    let totalCostUsd = 0;
    const internals: { conversationId: string; clientId: string | null; groupJid: string | null; internalPurpose: string | null }[] = [];

    for (const conversation of conversations) {
      try {
        const clientId = conversation.client?.id ?? null;
        const groupJid = conversation.groupJid ?? null;

        // Si ya existe una review no-rechazada, skip la IA
        const existingReview = await this.internalChannelReviewRepo.findNonRejectedByClientOrGroup({
          tenantId,
          clientId,
          groupJid,
        });

        if (existingReview) {
          internalsDetected++;
          this.logger.log(`Skipping AI for internal conversation ${conversation.id} (review status: ${existingReview.status})`);
          continue;
        }

        const result = await this.analysisService.runAnalysis(
          conversation,
          tenantId,
          messageLimit,
        );

        if (result.warnings.some((w) => w.type === 'no_messages')) {
          this.logger.log(`Skipping conversation ${conversation.id}: no messages`);
          continue;
        }

        analyzed++;
        totalCostUsd += result.creditsUsed;

        await this.conversationAnalysisRepo.upsertInternal({
          conversationId: conversation.id,
          isInternal: result.isInternal,
          internalPurpose: result.internalPurpose,
        });

        if (result.isInternal) {
          internalsDetected++;
          await this.internalChannelReviewRepo.upsert({
            tenantId,
            clientId,
            groupJid,
            internalPurpose: result.internalPurpose,
            channelName: result.channelName,
          });
          internals.push({ conversationId: conversation.id, clientId, groupJid, internalPurpose: result.internalPurpose });
        }
      } catch (error) {
        this.logger.error(
          `Batch analysis failed for conversation ${conversation.id}: ${error.message}`,
        );
      }
    }

    const analyses = await this.conversationAnalysisRepo.findAllByTenantId(tenantId);
    const grouped = this.groupByIntent(analyses);
    const intents = Array.from(grouped.entries()).map(([intent, items]) => ({ intent, count: items.length }));

    return { analyzed, internalsDetected, totalCostUsd, intents, internals };
  }

  async generateDiagrams(tenantId: string): Promise<{ diagramsGenerated: number; totalCostUsd: number; flows: { flowId: string; intentName: string }[] }> {
    const analyses = await this.conversationAnalysisRepo.findAllByTenantId(tenantId);
    const rawIntents = [...new Set(analyses.map((a) => a.intent).filter((i): i is string => !!i))];
    const normalizationMap = await this.intentClassifierNode.classify({
      rawIntents,
      existingIntents: (await this.intentRepo.findActiveByTenantId(tenantId)).map((i) => i.name),
    });
    const grouped = this.groupByIntent(analyses, normalizationMap);

    let diagramsGenerated = 0;
    let totalCostUsd = 0;
    const flows: { flowId: string; intentName: string }[] = [];

    for (const [intentName, intentAnalyses] of grouped.entries()) {
        let existingIntent = await this.intentRepo.findByTenantIdAndName(tenantId, intentName);
        let flowId: string;

        if (existingIntent?.flowId) {
          flowId = existingIntent.flowId;
        } else {
          const flow = await this.nodeRepo.createDraftFlow({
            name: `[Borrador] ${intentName}`,
            tenantId,
          });
          await this.intentRepo.upsert(tenantId, intentName, flow.id);
          const analysisIds = intentAnalyses.map((a) => a.id);
          await this.flowIntentRepo.linkAnalysesToFlow(analysisIds, flow.id);
          flowId = flow.id;
          this.logger.log(`generateDiagrams: created draft flow for intent "${intentName}": flowId=${flowId}`);
        }

        const conversationFlows = intentAnalyses.map((a) => ({
          flowSummary: a.flowSummary,
          flowDiagram: a.flowDiagram,
        }));

        const INITIAL_BATCH = 15;
        const BATCH_SIZE = 10;
        let costUsd = 0;

        // Si ya existe diagrama consolidado → refinar desde ahí, todo en batches de 10
        const existingVersion = await this.flowVersionRepo.findLatestWithDiagram(flowId);
        let currentDiagram: string | null = existingVersion?.consolidatedDiagram ?? null;
        const isRefinement = !!currentDiagram;

        let remaining: typeof conversationFlows;

        if (isRefinement) {
          remaining = conversationFlows;
        } else {
          const firstBatch = conversationFlows.slice(0, INITIAL_BATCH);
          if (firstBatch.length > 0) {
            const result = await this.diagramConsolidatorNode.consolidate({
              intentName,
              conversationFlows: firstBatch,
              currentDiagram: null,
            });
            currentDiagram = result.diagram;
            costUsd += result.costUsd;
            this.logger.log(`generateDiagrams [${intentName}]: initial batch (${firstBatch.length} flows)`);
          }
          remaining = conversationFlows.slice(INITIAL_BATCH);
        }
        for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
          const batch = remaining.slice(i, i + BATCH_SIZE);
          const result = await this.diagramConsolidatorNode.consolidate({
            intentName,
            conversationFlows: batch,
            currentDiagram,
          });
          currentDiagram = result.diagram;
          costUsd += result.costUsd;
          this.logger.log(`generateDiagrams [${intentName}]: refinement batch ${Math.floor(i / BATCH_SIZE) + 1}`);
        }

        if (!currentDiagram) throw new UnprocessableEntityException(`Intent "${intentName}": no conversation flows to consolidate`);

        await this.flowVersionRepo.saveConsolidatedDiagram(flowId, currentDiagram);
        totalCostUsd += costUsd;
        diagramsGenerated++;
        flows.push({ flowId, intentName });
        this.logger.log(`generateDiagrams [${intentName}]: diagram saved for flowId=${flowId}`);
    }

    return { diagramsGenerated, totalCostUsd, flows };
  }

  async generateDraftFlows(tenantId: string): Promise<{ flowsGenerated: number; flows: any[] }> {
    const analyses = await this.conversationAnalysisRepo.findAllByTenantId(tenantId);

    const [activeIntents, activeFlows] = await Promise.all([
      this.intentRepo.findActiveByTenantId(tenantId),
      this.nodeRepo.findAllFlowsByTenantId(tenantId).then((flows) =>
        flows.filter((f) => f.status === 'active'),
      ),
    ]);

    // Clasificar y normalizar intents antes de agrupar
    const rawIntents = [...new Set(analyses.map((a) => a.intent).filter((i): i is string => !!i))];
    const normalizationMap = await this.intentClassifierNode.classify({
      rawIntents,
      existingIntents: activeIntents.map((i) => i.name),
    });

    const grouped = this.groupByIntent(analyses, normalizationMap);

    const internalChannels = await this.prisma.contactLabel.findMany({
      where: { tenantId, status: 'draft' },
      select: { label: true },
    });

    let flowsGenerated = 0;
    const flows: any[] = [];

    const internalChannelLabels = internalChannels.map((c) => ({
      label: c.label,
      internalPurpose: null,
    }));

    for (const [intentName, intentAnalyses] of grouped.entries()) {
      const existingIntent = await this.intentRepo.findByTenantIdAndName(tenantId, intentName);
      if (!existingIntent?.flowId) {
        throw new ConflictException(`Intent "${intentName}" has no flow — run generate-diagrams first`);
      }

      const flowId = existingIntent.flowId;
      const latestVersion = await this.flowVersionRepo.findLatestWithDiagram(flowId);
      if (!latestVersion?.diagramApproved) {
        throw new ForbiddenException(`Intent "${intentName}" diagram not approved — approve it before generating flows`);
      }

      const conversationFlows = intentAnalyses.map((a) => ({
        flowSummary: a.flowSummary,
        flowDiagram: a.flowDiagram,
      }));

      const baseVersion = (await this.flowVersionRepo.findPromotedByFlowId(flowId))
        ?? (await this.flowVersionRepo.findLatestByFlowId(flowId));
      const baseSnapshot = baseVersion?.nodesSnapshot as any;
      const initialCases: import('./langgraph/nodes/flow-generator.node').RepresentativeCase[] =
        Array.isArray(baseSnapshot?.selectedCases) ? baseSnapshot.selectedCases : [];

      const generated = await this.processBatches({
        intentName,
        conversationFlows,
        internalChannels: internalChannelLabels,
        existingFlows: activeFlows.map((f) => ({ name: f.name, nodes: f.nodes })),
        existingIntents: activeIntents.map((i) => ({ name: i.name })),
        initialCases: initialCases.length > 0 ? initialCases : undefined,
      });

      const snapshot: import('@modules/nodes/repositories/flow-version.repository').DraftFlowSnapshot = {
        nodes: generated.nodes.map((n) => ({ name: n.name, systemPrompt: n.systemPrompt, todos: n.todos, tools: n.tools })),
        transitions: generated.transitions,
        selectedCases: generated.selectedCases,
      };
      const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      await this.flowVersionRepo.saveVersion(flowId, snapshot, hash, generated.proposedTools);

      const analysisIds = intentAnalyses.map((a) => a.id);
      await this.flowIntentRepo.linkAnalysesToFlow(analysisIds, flowId);

      flowsGenerated++;
      flows.push({ id: flowId, name: existingIntent.flow?.name ?? intentName });
      this.logger.log(`Generated nodes for intent "${intentName}": flowId=${flowId}`);
    }

    return { flowsGenerated, flows };
  }

  private async processBatches(input: {
    intentName: string;
    conversationFlows: { flowSummary: string | null; flowDiagram: string | null }[];
    internalChannels: { label: string; internalPurpose: string | null }[];
    existingFlows: { name: string; nodes: { node: { name: string; systemPrompt: string } }[] }[];
    existingIntents: { name: string }[];
    initialCases?: import('./langgraph/nodes/flow-generator.node').RepresentativeCase[];
  }): Promise<FlowGeneratorOutput> {
    const { conversationFlows, initialCases, ...rest } = input;

    // Intent existente → refinado desde el inicio, batches de 10
    // Intent nuevo → primer batch de 15 (creación inicial), luego batches de 10
    const isRefinement = !!initialCases;
    const INITIAL_BATCH = isRefinement ? 0 : 15;
    const BATCH_SIZE = 10;

    let currentCases = initialCases;
    let lastOutput: FlowGeneratorOutput | undefined = undefined;

    if (!isRefinement) {
      // Primer batch de 15 para crear el flow base
      const firstBatch = conversationFlows.slice(0, INITIAL_BATCH);
      if (firstBatch.length > 0) {
        lastOutput = await this.flowGeneratorNode.generate({
          ...rest,
          conversationFlows: firstBatch,
          currentCases: undefined,
        });
        currentCases = lastOutput.selectedCases;
        this.logger.log(`processBatches [${input.intentName}]: initial batch (${firstBatch.length} flows)`);
      }
    }

    const remaining = conversationFlows.slice(INITIAL_BATCH);
    const totalBatches = Math.ceil(remaining.length / BATCH_SIZE);

    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      const batch = remaining.slice(i, i + BATCH_SIZE);
      lastOutput = await this.flowGeneratorNode.generate({
        ...rest,
        conversationFlows: batch,
        currentCases,
      });
      currentCases = lastOutput.selectedCases;
      this.logger.log(`processBatches [${input.intentName}]: refinement batch ${Math.floor(i / BATCH_SIZE) + 1}/${totalBatches}`);
    }

    if (!lastOutput) {
      throw new Error(`processBatches [${input.intentName}]: no analyses to process`);
    }

    return lastOutput;
  }

  private groupByIntent(
    analyses: { id: string; intent: string | null; flowSummary: string | null; flowDiagram: string | null }[],
    normalizationMap?: Map<string, string>,
  ): Map<string, typeof analyses> {
    const map = new Map<string, typeof analyses>();
    for (const analysis of analyses) {
      if (!analysis.intent) continue;
      const key = normalizationMap?.get(analysis.intent) ?? analysis.intent;
      const existing = map.get(key) ?? [];
      existing.push(analysis);
      map.set(key, existing);
    }
    return map;
  }

  private async getActiveConversations(tenantId: string, channelCount: number) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        isActive: true,
        phone: { tenantId },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: channelCount,
      select: {
        id: true,
        phoneId: true,
        groupJid: true,
        phone: { select: { id: true, tenantId: true } },
        participants: {
          take: 1,
          select: { client: { select: { id: true, phoneNumber: true, name: true } } },
        },
      },
    });

    return conversations.map((c) => ({
      id: c.id,
      phoneId: c.phoneId,
      groupJid: c.groupJid,
      phone: c.phone,
      client: c.participants[0]?.client ?? null,
    }));
  }
}
