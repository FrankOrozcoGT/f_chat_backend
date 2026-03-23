import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { FlowIntentRepository } from './repositories/flow-intent.repository';
import { FlowGeneratorNode } from './langgraph/nodes/flow-generator.node';
import { IntentRepository } from '@modules/nodes/repositories/intent.repository';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';

@Injectable()
export class BatchAnalysisService {
  private readonly logger = new Logger(BatchAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: ConversationAnalysisService,
    private readonly clientLabelRepo: ClientLabelRepository,
    private readonly conversationAnalysisRepo: ConversationAnalysisRepository,
    private readonly flowIntentRepo: FlowIntentRepository,
    private readonly flowGeneratorNode: FlowGeneratorNode,
    private readonly intentRepo: IntentRepository,
    private readonly nodeRepo: NodeRepository,
  ) {}

  async runBatch(
    tenantId: string,
    channelCount: number,
    messageLimit: number,
  ): Promise<{ analyzed: number; internalsDetected: number; totalCostUsd: number }> {
    const conversations = await this.getActiveConversations(tenantId, channelCount);

    let analyzed = 0;
    let internalsDetected = 0;
    let totalCostUsd = 0;

    for (const conversation of conversations) {
      try {
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
          const client = conversation.client;
          await this.clientLabelRepo.upsertDraftLabel({
            tenantId,
            clientId: client?.id ?? null,
            groupJid: conversation.groupJid ?? null,
            internalPurpose: result.internalPurpose ?? '',
          });
        }
      } catch (error) {
        this.logger.error(
          `Batch analysis failed for conversation ${conversation.id}: ${error.message}`,
        );
      }
    }

    return { analyzed, internalsDetected, totalCostUsd };
  }

  async generateDraftFlows(tenantId: string): Promise<{ flowsGenerated: number }> {
    const analyses = await this.conversationAnalysisRepo.findAllByTenantId(tenantId);
    const grouped = this.groupByIntent(analyses);

    const [activeIntents, activeFlows] = await Promise.all([
      this.intentRepo.findActiveByTenantId(tenantId),
      this.nodeRepo.findAllFlowsByTenantId(tenantId).then((flows) =>
        flows.filter((f) => f.status === 'active'),
      ),
    ]);

    const internalChannels = await this.prisma.contactLabel.findMany({
      where: { tenantId, status: 'draft' },
      select: { label: true },
    });

    let flowsGenerated = 0;

    for (const [intentName, intentAnalyses] of grouped.entries()) {
      try {
        const conversationFlows = intentAnalyses.map((a) => ({
          flowSummary: a.flowSummary,
          flowDiagram: a.flowDiagram,
        }));

        const internalChannelLabels = internalChannels.map((c) => ({
          label: c.label,
          internalPurpose: null,
        }));

        const generated = await this.flowGeneratorNode.generate({
          intentName,
          conversationFlows,
          internalChannels: internalChannelLabels,
          existingFlows: activeFlows.map((f) => ({ name: f.name, nodes: f.nodes })),
          existingIntents: activeIntents.map((i) => ({ name: i.name })),
        });

        const { flow } = await this.nodeRepo.createFlowWithNodes({
          name: `[Borrador] ${intentName}`,
          tenantId,
          nodes: generated.nodes,
          transitions: generated.transitions,
        });

        await this.intentRepo.upsert(tenantId, intentName, flow.id);

        const analysisIds = intentAnalyses.map((a) => a.id);
        await this.flowIntentRepo.linkAnalysesToFlow(analysisIds, flow.id);

        flowsGenerated++;
        this.logger.log(`Generated draft flow for intent "${intentName}": flowId=${flow.id}`);
      } catch (error) {
        this.logger.error(`Failed to generate flow for intent "${intentName}": ${error.message}`);
      }
    }

    return { flowsGenerated };
  }

  private groupByIntent(
    analyses: { id: string; intent: string | null; flowSummary: string | null; flowDiagram: string | null }[],
  ): Map<string, typeof analyses> {
    const map = new Map<string, typeof analyses>();
    for (const analysis of analyses) {
      if (!analysis.intent) continue;
      const existing = map.get(analysis.intent) ?? [];
      existing.push(analysis);
      map.set(analysis.intent, existing);
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
