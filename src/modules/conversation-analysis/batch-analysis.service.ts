import { Injectable, Logger, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { InternalChannelReviewRepository } from './repositories/internal-channel-review.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { FlowIntentRepository } from './repositories/flow-intent.repository';
import { FlowGeneratorNode } from './langgraph/nodes/flow-generator.node';
import { DiagramConsolidatorNode } from './langgraph/nodes/diagram-consolidator.node';
import { IntentRepository } from '@modules/nodes/repositories/intent.repository';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { FlowVersionRepository, DraftFlowSnapshot } from '@modules/nodes/repositories/flow-version.repository';
import { createHash } from 'crypto';
import { ensureError } from '@common/utils/ensure-error';

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
    const accumulatedIntents = new Set<string>();

    for (const conversation of conversations) {
      try {
        const clientId = conversation.client?.id ?? null;
        const groupJid = conversation.groupJid ?? null;

        // Si ya existe una review no-rechazada, verificar si tiene purpose
        const existingReview = await this.internalChannelReviewRepo.findNonRejectedByClientOrGroup({
          tenantId,
          clientId,
          groupJid,
        });

        if (existingReview && existingReview.internalPurpose) {
          internalsDetected++;
          this.logger.log(`Skipping AI for internal conversation ${conversation.id} (review with purpose, status: ${existingReview.status})`);
          continue;
        }

        const knownInternal = !!existingReview;

        const result = await this.analysisService.runAnalysis(
          conversation,
          tenantId,
          messageLimit,
          [...accumulatedIntents],
          knownInternal,
        );

        if (result.warnings.some((w) => w.type === 'no_messages')) {
          this.logger.log(`Skipping conversation ${conversation.id}: no messages`);
          continue;
        }

        analyzed++;
        totalCostUsd += result.creditsUsed;

        // Aplicar renames de intents
        for (const rename of result.intentRenames) {
          if (accumulatedIntents.has(rename.from)) {
            accumulatedIntents.delete(rename.from);
            accumulatedIntents.add(rename.to);
            // Renombrar en analyses anteriores
            await this.conversationAnalysisRepo.renameIntent(rename.from, rename.to, tenantId);
            this.logger.log(`Intent renamed: "${rename.from}" → "${rename.to}"`);
          }
        }

        result.detectedIntents.forEach((i) => accumulatedIntents.add(i));

        await this.conversationAnalysisRepo.upsertInternal({
          conversationId: conversation.id,
          isInternal: result.isInternal,
          internalPurpose: result.internalPurpose,
        });

        if (result.isInternal) {
          internalsDetected++;

          if (groupJid) {
            // Grupo interno: crear review por cada participante con groupJid
            if (result.participants.length === 0) {
              throw new Error(`Group ${conversation.id} marked as internal but AI returned 0 participants`);
            }
            for (const participant of result.participants) {
              const phoneNumber = participant.senderJid.replace('@s.whatsapp.net', '');
              const matchedClient = conversation.allParticipants.find((p) => p.phoneNumber === phoneNumber);
              if (matchedClient) {
                await this.internalChannelReviewRepo.upsert({
                  tenantId,
                  clientId: matchedClient.id,
                  groupJid,
                  internalPurpose: participant.internalPurpose,
                  channelName: participant.channelName,
                });
                this.logger.log(`Created group participant review: ${participant.channelName} → clientId=${matchedClient.id}, groupJid=${groupJid}`);
              }
            }
          } else {
            // Individual interno: una review con clientId
            await this.internalChannelReviewRepo.upsert({
              tenantId,
              clientId,
              groupJid: null,
              internalPurpose: result.internalPurpose,
              channelName: result.channelName,
            });
          }

          internals.push({ conversationId: conversation.id, clientId, groupJid, internalPurpose: result.internalPurpose });
        }
      } catch (e) {
        const error = ensureError(e);
        this.logger.error(
          `Batch analysis failed for conversation ${conversation.id}: ${error.message}`,
        );
      }
    }

    const analyses = await this.conversationAnalysisRepo.findAllByTenantId(tenantId);
    const grouped = this.groupByIntent(analyses);
    const intents = Array.from(grouped.entries()).map(([intent, items]) => ({
      intent,
      description: items.find((a) => a.intentDescription)?.intentDescription ?? null,
      count: items.length,
    }));

    return { analyzed, internalsDetected, totalCostUsd, intents, internals };
  }

  async generateDiagrams(tenantId: string): Promise<{ diagramsGenerated: number; totalCostUsd: number; flows: { flowId: string; intentName: string }[]; errors: { intentName: string; error: string }[] }> {
    const analyses = await this.conversationAnalysisRepo.findAllByTenantId(tenantId);
    this.logger.log(`generateDiagrams: ${analyses.length} analyses found`);

    const internals = await this.internalChannelReviewRepo.findApprovedByTenantId(tenantId);
    this.logger.log(`generateDiagrams: ${internals.length} approved internals`);
    const grouped = this.groupByIntent(analyses);
    this.logger.log(`generateDiagrams: ${grouped.size} intents: ${[...grouped.entries()].map(([k, v]) => `${k}(${v.length})`).join(', ')}`);

    let diagramsGenerated = 0;
    let totalCostUsd = 0;
    const flows: { flowId: string; intentName: string }[] = [];
    const errors: { intentName: string; error: string }[] = [];

    for (const [intentName, intentAnalyses] of grouped.entries()) {
      try {
        const intentDescription = intentAnalyses.find((a) => a.intentDescription)?.intentDescription ?? null;
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
          flowId = flow.id;
          this.logger.log(`generateDiagrams: created draft flow for intent "${intentName}": flowId=${flowId}`);
        }

        const analysisIds = intentAnalyses.map((a) => a.id);
        await this.flowIntentRepo.linkAnalysesToFlow(analysisIds, flowId);

        const conversationFlows = intentAnalyses.map((a) => ({
          conversationId: a.conversationId,
          flowSummary: a.flowSummary,
          flowDiagram: a.flowDiagram,
        }));

        const INITIAL_BATCH = 15;
        const BATCH_SIZE = 10;
        let costUsd = 0;

        const existingVersion = await this.flowVersionRepo.findLatestWithDiagram(flowId);
        let currentDiagram: string | null = existingVersion?.consolidatedDiagram ?? null;
        let currentNodeMapping: Record<string, any[]> | null = (existingVersion as any)?.nodeMapping ?? null;
        let currentNodeCategories: Record<string, string> = {};
        let currentInternalQueues: any[] = [];
        let currentRepresentativeCases: any[] = [];
        const isRefinement = !!currentDiagram;

        let remaining: typeof conversationFlows;

        if (isRefinement) {
          remaining = conversationFlows;
        } else {
          const firstBatch = conversationFlows.slice(0, INITIAL_BATCH);
          if (firstBatch.length > 0) {
            const result = await this.diagramConsolidatorNode.consolidate({
              intentName,
              intentDescription,
              conversationFlows: firstBatch,
              internals,
              currentDiagram: null,
              currentNodeMapping: null,
            });
            currentDiagram = result.diagram;
            currentNodeMapping = result.nodeMapping;
            currentNodeCategories = result.nodeCategories;
            currentInternalQueues = result.internalQueues;
            currentRepresentativeCases = result.representativeCases;
            costUsd += result.costUsd;
            this.logger.log(`generateDiagrams [${intentName}]: initial batch (${firstBatch.length} flows)`);
          }
          remaining = conversationFlows.slice(INITIAL_BATCH);
        }
        for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
          try {
            const batch = remaining.slice(i, i + BATCH_SIZE);
            const result = await this.diagramConsolidatorNode.consolidate({
              intentName,
              intentDescription,
              conversationFlows: batch,
              internals,
              currentDiagram,
              currentNodeMapping,
              currentRepresentativeCases,
            });
            currentDiagram = result.diagram;
            currentNodeMapping = result.nodeMapping;
            currentNodeCategories = result.nodeCategories;
            currentInternalQueues = result.internalQueues;
            currentRepresentativeCases = result.representativeCases;
            costUsd += result.costUsd;
            this.logger.log(`generateDiagrams [${intentName}]: refinement batch ${Math.floor(i / BATCH_SIZE) + 1}`);
          } catch (e) {
        const batchError = ensureError(e);
            this.logger.error(`generateDiagrams [${intentName}]: refinement batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${batchError.message}`);
            errors.push({ intentName, error: `batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${batchError.message}` });
            break;
          }
        }

        if (!currentDiagram) throw new Error(`no conversation flows to consolidate`);
        if (!currentNodeMapping) throw new Error(`no nodeMapping generated for intent "${intentName}"`);

        await this.flowVersionRepo.saveConsolidatedDiagram(flowId, currentDiagram, currentNodeMapping, currentNodeCategories, currentInternalQueues, currentRepresentativeCases);
        totalCostUsd += costUsd;
        diagramsGenerated++;
        flows.push({ flowId, intentName });
        this.logger.log(`generateDiagrams [${intentName}]: diagram saved for flowId=${flowId}`);
      } catch (e) {
        const error = ensureError(e);
        this.logger.error(`generateDiagrams failed for intent "${intentName}": ${error.message}`);
        errors.push({ intentName, error: error.message });
      }

      // Delay between intents to avoid overloading Kimi
      await new Promise((r) => setTimeout(r, 2000));
    }

    return { diagramsGenerated, totalCostUsd, flows, errors };
  }

  async regenerateDiagram(flowId: string): Promise<{ flowId: string; intentName: string; costUsd: number; removedInternals: number }> {
    const flow = await this.prisma.flow.findUnique({
      where: { id: flowId },
      select: { id: true, tenantId: true, intents: { select: { name: true } } },
    });
    if (!flow) throw new Error(`Flow ${flowId} not found`);
    const intentName = flow.intents[0]?.name;
    if (!intentName) throw new Error(`Flow ${flowId} has no intent`);

    const internals = await this.internalChannelReviewRepo.findApprovedByTenantId(flow.tenantId);

    // Eliminar links a análisis que ahora son internos
    const deleted = await this.flowIntentRepo.deleteInternalByFlowId(flowId);
    const removedInternals = deleted.count;
    if (removedInternals > 0) {
      this.logger.log(`regenerateDiagram [${intentName}]: removed ${removedInternals} internal analysis links`);
    }

    const records = await this.flowIntentRepo.findByFlowId(flowId);
    const intentDescription = records.find((r) => r.analysis.intentDescription)?.analysis.intentDescription ?? null;
    const conversationFlows = records
      .filter((r) => r.analysis.flowSummary || r.analysis.flowDiagram)
      .map((r) => ({
        conversationId: r.analysis.conversationId,
        flowSummary: r.analysis.flowSummary,
        flowDiagram: r.analysis.flowDiagram,
      }));

    if (conversationFlows.length === 0) {
      throw new Error(`Flow ${flowId} has no analyses to consolidate`);
    }

    const INITIAL_BATCH = 15;
    const BATCH_SIZE = 10;
    let costUsd = 0;
    let currentDiagram: string | null = null;
    let currentNodeMapping: Record<string, any[]> | null = null;
    let currentNodeCategories: Record<string, string> = {};
    let currentInternalQueues: any[] = [];
    let currentRepresentativeCases: any[] = [];

    const firstBatch = conversationFlows.slice(0, INITIAL_BATCH);
    if (firstBatch.length > 0) {
      const result = await this.diagramConsolidatorNode.consolidate({
        intentName,
        intentDescription,
        conversationFlows: firstBatch,
        internals,
        currentDiagram: null,
        currentNodeMapping: null,
      });
      currentDiagram = result.diagram;
      currentNodeMapping = result.nodeMapping;
      currentNodeCategories = result.nodeCategories;
      currentInternalQueues = result.internalQueues;
      currentRepresentativeCases = result.representativeCases;
      costUsd += result.costUsd;
      this.logger.log(`regenerateDiagram [${intentName}]: initial batch (${firstBatch.length} flows)`);
    }

    const remaining = conversationFlows.slice(INITIAL_BATCH);
    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      try {
        const batch = remaining.slice(i, i + BATCH_SIZE);
        const result = await this.diagramConsolidatorNode.consolidate({
          intentName,
          intentDescription,
          conversationFlows: batch,
          internals,
          currentDiagram,
          currentNodeMapping,
          currentRepresentativeCases,
        });
        currentDiagram = result.diagram;
        currentNodeMapping = result.nodeMapping;
        currentNodeCategories = result.nodeCategories;
        currentInternalQueues = result.internalQueues;
        currentRepresentativeCases = result.representativeCases;
        costUsd += result.costUsd;
        this.logger.log(`regenerateDiagram [${intentName}]: refinement batch ${Math.floor(i / BATCH_SIZE) + 1}`);
      } catch (e) {
        const batchError = ensureError(e);
        this.logger.error(`regenerateDiagram [${intentName}]: refinement batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${batchError.message}`);
        break;
      }
    }

    if (!currentDiagram) throw new Error(`regenerateDiagram [${intentName}]: no diagram generated`);
    if (!currentNodeMapping) throw new Error(`regenerateDiagram [${intentName}]: no nodeMapping generated`);

    await this.flowVersionRepo.saveConsolidatedDiagram(flowId, currentDiagram, currentNodeMapping, currentNodeCategories, currentInternalQueues, currentRepresentativeCases);
    this.logger.log(`regenerateDiagram [${intentName}]: diagram saved for flowId=${flowId}`);

    return { flowId, intentName, costUsd, removedInternals };
  }

  async mergeIntents(tenantId: string, sourceIntentIds: string[], targetIntentId: string) {
    const target = await this.prisma.intent.findUnique({ where: { id: targetIntentId }, include: { flow: true } });
    if (!target) throw new BadRequestException(`Target intent ${targetIntentId} not found`);
    if (target.tenantId !== tenantId) throw new ForbiddenException('Target intent does not belong to this tenant');
    if (!target.flowId) throw new BadRequestException(`Target intent "${target.name}" has no flow`);

    const sources = await this.prisma.intent.findMany({
      where: { id: { in: sourceIntentIds } },
      include: { flow: true },
    });
    if (sources.length !== sourceIntentIds.length) {
      const found = new Set(sources.map((s) => s.id));
      const missing = sourceIntentIds.filter((id) => !found.has(id));
      throw new BadRequestException(`Source intents not found: ${missing.join(', ')}`);
    }
    for (const source of sources) {
      if (source.tenantId !== tenantId) throw new ForbiddenException(`Source intent ${source.id} does not belong to this tenant`);
    }

    let totalMergedAnalyses = 0;
    const removedFlows: string[] = [];
    const newConversationFlows: { conversationId: string; flowSummary: string | null; flowDiagram: string | null }[] = [];

    for (const source of sources) {
      // 1. Rename analyses
      const updated = await this.prisma.conversationAnalysis.updateMany({
        where: { intent: source.name, conversation: { phone: { tenantId } } },
        data: { intent: target.name },
      });
      totalMergedAnalyses += updated.count;
      this.logger.log(`mergeIntents: renamed ${updated.count} analyses from "${source.name}" to "${target.name}"`);

      // 2. Move analysis links and collect conversation flows for refinement
      if (source.flowId) {
        const sourceLinks = await this.prisma.conversationAnalysisFlow.findMany({
          where: { flowId: source.flowId },
          select: { id: true, analysisId: true, analysis: { select: { conversationId: true, flowSummary: true, flowDiagram: true } } },
        });

        for (const link of sourceLinks) {
          const exists = await this.prisma.conversationAnalysisFlow.findUnique({
            where: { analysisId_flowId: { analysisId: link.analysisId, flowId: target.flowId! } },
          });
          if (!exists) {
            await this.prisma.conversationAnalysisFlow.update({
              where: { id: link.id },
              data: { flowId: target.flowId! },
            });
          } else {
            await this.prisma.conversationAnalysisFlow.delete({ where: { id: link.id } });
          }

          if (link.analysis.flowSummary || link.analysis.flowDiagram) {
            newConversationFlows.push({
              conversationId: link.analysis.conversationId,
              flowSummary: link.analysis.flowSummary,
              flowDiagram: link.analysis.flowDiagram,
            });
          }
        }
        this.logger.log(`mergeIntents: moved ${sourceLinks.length} analysis links to flow ${target.flowId}`);
      }

      // 3. Delete source intent + its flow
      if (source.flowId) removedFlows.push(source.flowId);
      await this.prisma.intent.delete({ where: { id: source.id } });
      if (source.flowId) {
        await this.prisma.flow.delete({ where: { id: source.flowId } });
        this.logger.log(`mergeIntents: deleted source intent "${source.name}" and flow ${source.flowId}`);
      }
    }

    // 4. Refine existing diagram with new conversations (no regenerate from scratch)
    let refinement: { flowId: string; intentName: string; costUsd: number; newFlows: number } | null = null;
    if (newConversationFlows.length > 0) {
      const internals = await this.internalChannelReviewRepo.findApprovedByTenantId(tenantId);
      const existingVersion = await this.flowVersionRepo.findLatestWithDiagram(target.flowId!);
      const currentDiagram = existingVersion?.consolidatedDiagram ?? null;
      const currentNodeMapping = (existingVersion as any)?.nodeMapping ?? null;
      const currentRepresentativeCases = (existingVersion as any)?.representativeCases ?? [];

      const BATCH_SIZE = 10;
      let diagram = currentDiagram;
      let nodeMapping = currentNodeMapping;
      let nodeCategories: Record<string, string> = {};
      let internalQueues: any[] = [];
      let representativeCases: any[] = currentRepresentativeCases;
      let costUsd = 0;

      for (let i = 0; i < newConversationFlows.length; i += BATCH_SIZE) {
        const batch = newConversationFlows.slice(i, i + BATCH_SIZE);
        const result = await this.diagramConsolidatorNode.consolidate({
          intentName: target.name,
          intentDescription: null,
          conversationFlows: batch,
          internals,
          currentDiagram: diagram,
          currentNodeMapping: nodeMapping,
          currentRepresentativeCases: representativeCases,
        });
        diagram = result.diagram;
        nodeMapping = result.nodeMapping;
        nodeCategories = result.nodeCategories;
        internalQueues = result.internalQueues;
        representativeCases = result.representativeCases;
        costUsd += result.costUsd;
      }

      if (diagram) {
        await this.flowVersionRepo.saveConsolidatedDiagram(target.flowId!, diagram, nodeMapping ?? {}, nodeCategories, internalQueues, representativeCases);
        this.logger.log(`mergeIntents: refined diagram for flow ${target.flowId}, cost=$${costUsd.toFixed(6)}`);
      }
      refinement = { flowId: target.flowId!, intentName: target.name, costUsd, newFlows: newConversationFlows.length };
    }

    return { mergedAnalyses: totalMergedAnalyses, removedFlows, refinement };
  }

  async generateDraftFlows(tenantId: string): Promise<{ flowsGenerated: number; flows: any[]; errors: { intentName: string; error: string }[] }> {
    const allIntents = await this.intentRepo.findActiveByTenantId(tenantId);

    // Filtrar solo intents con diagrama aprobado — los demás se ignoran silenciosamente
    const intents: typeof allIntents = [];
    for (const intent of allIntents) {
      if (!intent.flowId) continue;
      const version = await this.flowVersionRepo.findLatestWithDiagram(intent.flowId);
      if (version?.diagramApproved && version.consolidatedDiagram) {
        intents.push(intent);
      }
    }

    let flowsGenerated = 0;
    const flows: any[] = [];
    const errors: { intentName: string; error: string }[] = [];

    for (const intent of intents) {
      try {
        const flowId = intent.flowId!;
        const latestVersion = (await this.flowVersionRepo.findLatestWithDiagram(flowId))!;

        const analyses = await this.flowIntentRepo.findByFlowId(flowId);
        const analysesInput = analyses.map((link) => ({
          id: link.analysis.id,
          flowSummary: link.analysis.flowSummary,
          flowDiagram: link.analysis.flowDiagram,
        }));

        const generated = await this.flowGeneratorNode.generate({
          intentName: intent.name,
          consolidatedDiagram: latestVersion.consolidatedDiagram!,
          internalQueues: (latestVersion.internalQueues as { channelName: string; nodeId: string; queueType: string; usage: string }[] | null) ?? [],
          analyses: analysesInput,
        });

        if (generated.flows.length === 1) {
          // No split — guardar en el flow existente
          const gen = generated.flows[0];
          const snapshot: DraftFlowSnapshot = {
            nodes: gen.nodes.map((n) => ({ name: n.name, systemPrompt: n.systemPrompt, todos: n.todos, tools: n.tools })),
            transitions: gen.transitions,
          };
          const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
          await this.flowVersionRepo.updateVersionNodes(
            latestVersion.id,
            snapshot,
            hash,
            gen.proposedTools,
          );

          flowsGenerated++;
          flows.push({ id: flowId, name: intent.name });
          this.logger.log(`Generated nodes for intent "${intent.name}" (no split): flowId=${flowId}`);
        } else {
          // Split — crear N nuevos intents+flows, reasignar analyses, borrar intent+flow originales
          this.logger.log(`Intent "${intent.name}" split into ${generated.flows.length} sub-intents`);
          const createdFlowIds: { intentName: string; flowId: string }[] = [];

          for (const gen of generated.flows) {
            const newFlow = await this.nodeRepo.createDraftFlow({
              name: `[Borrador] ${gen.intentName}`,
              tenantId,
            });
            await this.intentRepo.create(tenantId, { name: gen.intentName, flowId: newFlow.id });

            const snapshot: DraftFlowSnapshot = {
              nodes: gen.nodes.map((n) => ({ name: n.name, systemPrompt: n.systemPrompt, todos: n.todos, tools: n.tools })),
              transitions: gen.transitions,
            };
            const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
            await this.flowVersionRepo.saveVersion(
              newFlow.id,
              snapshot,
              hash,
              gen.proposedTools,
            );

            if (gen.assignedAnalysisIds.length > 0) {
              await this.flowIntentRepo.linkAnalysesToFlow(gen.assignedAnalysisIds, newFlow.id);
            }

            createdFlowIds.push({ intentName: gen.intentName, flowId: newFlow.id });
            flowsGenerated++;
            flows.push({ id: newFlow.id, name: gen.intentName });
          }

          // Borrar intent+flow originales (cascade limpia flowIntent y flowVersions)
          await this.intentRepo.deleteById(intent.id, tenantId);
          await this.nodeRepo.deleteFlow(flowId, tenantId);

          this.logger.log(
            `Split completed: original intent "${intent.name}" deleted, new flows: ${createdFlowIds.map((c) => `${c.intentName}=${c.flowId}`).join(', ')}`,
          );
        }
      } catch (e) {
        const error = ensureError(e);
        this.logger.error(`generateDraftFlows failed for intent "${intent.name}": ${error.message}`);
        errors.push({ intentName: intent.name, error: error.message });
      }
    }

    return { flowsGenerated, flows, errors };
  }

  private groupByIntent(
    analyses: { id: string; conversationId: string; intent: string | null; intentDescription?: string | null; flowSummary: string | null; flowDiagram: string | null }[],
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
      allParticipants: c.participants.map((p) => p.client).filter((cl): cl is NonNullable<typeof cl> => !!cl),
    }));
  }
}
