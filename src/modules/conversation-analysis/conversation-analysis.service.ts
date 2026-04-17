import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InternalApiClient } from '@modules/ai/clients/internal-api.client';
import { LimitsService } from '@common/services/limits.service';
import { AnalysisWorkflow } from './langgraph/analysis-workflow';
import {
  SubConversation,
  AnalysisMessage,
} from './langgraph/analysis-state.interface';

export interface ConversationSplit {
  summary: string;
  messageIds: string[];
  intent: string | null;
  intentDescription: string | null;
  flowDiagram: string | null;
  flowSummary: string | null;
}

export interface ConversationForAnalysis {
  id: string;
  phoneId: string;
  groupJid?: string | null;
  phone: { id: string; tenantId: string };
  client: { id: string; phoneNumber: string; name: string | null } | null;
}

export interface AnalysisResult {
  createdConversations: { id: string; summary: string; isActive: boolean; messageCount: number }[];
  summary: string | null;
  creditsUsed: number;
  warnings: { messageId: string; type: string; message: string }[];
  remainingCount: number | null;
  lastMessageTranscription: string | null;
  isInternal: boolean;
  internalPurpose: string | null;
  channelName: string | null;
  detectedIntents: string[];
  intentRenames: { from: string; to: string }[];
  participants: { senderJid: string; channelName: string; internalPurpose: string }[];
}

@Injectable()
export class ConversationAnalysisService {
  private readonly logger = new Logger(ConversationAnalysisService.name);

  constructor(
    private readonly internalApi: InternalApiClient,
    private readonly limitsService: LimitsService,
    private readonly analysisWorkflow: AnalysisWorkflow,
  ) {}

  async runAnalysis(
    conversation: ConversationForAnalysis,
    tenantId: string,
    messageLimit?: number,
    existingIntents: string[] = [],
    knownInternal: boolean = false,
  ): Promise<AnalysisResult> {
    let limit = messageLimit;
    if (!limit) {
      const settings = await this.internalApi.getTenantSettings(tenantId);
      limit = settings.messageLimit;
    }
    await this.limitsService.validateCredits(tenantId, 1);

    const rawMessages = await this.internalApi.findLastNUnanalyzed(
      conversation.id,
      limit,
    );

    if (rawMessages.length === 0) {
      return {
        createdConversations: [],
        summary: null,
        creditsUsed: 0,
        warnings: [{ messageId: '', type: 'no_messages', message: 'No hay mensajes nuevos por analizar' }],
        remainingCount: null,
        lastMessageTranscription: null,
        isInternal: false,
        internalPurpose: null,
        channelName: null,
        detectedIntents: [],
        intentRenames: [],
        participants: [],
      };
    }

    const messages: AnalysisMessage[] = rawMessages.map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      direction: m.direction,
      senderType: m.senderType,
      transcription: m.transcription,
      mediaUrl: m.mediaUrl,
      metadata: m.metadata as Record<string, any> | null,
      createdAt: m.createdAt,
    }));

    const clientId = conversation.client?.id ?? null;
    const isGroup = !!conversation.groupJid;

    const result = await this.analysisWorkflow.execute({
      conversationId: conversation.id,
      tenantId,
      phoneId: conversation.phoneId,
      clientId,
      isGroup,
      knownInternal,
      messages,
      existingIntents,
    });

    if (!clientId) {
      throw new Error(
        `Cannot create sub-conversations: no clientId for conversation ${conversation.id}`,
      );
    }

    const splits = this.buildSplits(result.subConversations, messages);
    const orphanMessageIds = this.findOrphanPrefix(splits, messages);
    const batchMessageIds = messages.map((m) => m.id);

    const classifiedIds = new Set([
      ...orphanMessageIds,
      ...splits.flatMap((s) => s.messageIds),
    ]);
    const remainingInActive = batchMessageIds.filter((id) => !classifiedIds.has(id));

    const { createdConversations } = await this.internalApi.processAnalysisSplits({
      conversationId: conversation.id,
      phoneId: conversation.phoneId,
      clientId,
      batchMessageIds,
      splits,
      orphanMessageIds,
    });

    await this.internalApi.processAnalysisCatalog({
      tenantId,
      clientId,
      products: result.products,
      promotions: result.promotions,
    });

    if (result.realName && clientId) {
      await this.internalApi.updateClientName(clientId, result.realName);
    }

    const summary = result.subConversations?.length > 0
      ? result.subConversations.map((s) => s.summary).join('\n\n')
      : null;

    this.logger.log(
      `Analysis completed for conversation ${conversation.id}: ${createdConversations.length} sub-conversations, cost=$${result.totalCost.toFixed(6)}`,
    );

    const lastBatchMessage = result.processedMessages[result.processedMessages.length - 1] ?? null;

    return {
      createdConversations,
      summary,
      creditsUsed: result.totalCost,
      warnings: result.warnings,
      remainingCount: remainingInActive.length,
      lastMessageTranscription: lastBatchMessage?.transcription ?? null,
      isInternal: result.isInternal,
      internalPurpose: result.internalPurpose,
      channelName: result.channelName,
      detectedIntents: result.subConversations
        .map((s) => s.intent)
        .filter((i): i is string => !!i),
      intentRenames: result.intentRenames,
      participants: result.participants,
    };
  }

  validateOwnership(phoneTenantId: string, jwtTenantId: string): void {
    if (phoneTenantId !== jwtTenantId) {
      throw new ForbiddenException(
        'You do not have permission to analyze this conversation',
      );
    }
  }

  buildSplits(
    subConversations: SubConversation[],
    messages: AnalysisMessage[],
  ): ConversationSplit[] {
    return subConversations.map((sub) => {
      const firstIdx = messages.findIndex((m) => m.id === sub.firstMessageId);
      const lastIdx = messages.findIndex((m) => m.id === sub.lastMessageId);

      if (firstIdx === -1 || lastIdx === -1) {
        throw new Error(
          `Invalid message range: firstMessageId=${sub.firstMessageId}, lastMessageId=${sub.lastMessageId}`,
        );
      }

      const messageIds = messages.slice(firstIdx, lastIdx + 1).map((m) => m.id);
      return {
        summary: sub.summary,
        messageIds,
        intent: sub.intent ?? null,
        intentDescription: sub.intentDescription ?? null,
        flowDiagram: sub.flowDiagram ?? null,
        flowSummary: sub.flowSummary ?? null,
      };
    });
  }

  findOrphanPrefix(
    splits: ConversationSplit[],
    messages: AnalysisMessage[],
  ): string[] {
    if (splits.length === 0) return [];
    const firstSplitMessageId = splits[0].messageIds[0];
    if (!firstSplitMessageId) return [];
    const firstSplitIdx = messages.findIndex((m) => m.id === firstSplitMessageId);
    if (firstSplitIdx <= 0) return [];
    return messages.slice(0, firstSplitIdx).map((m) => m.id);
  }

  decidePriceAction(
    newPrice: number,
    currentBasePrice: number | null,
  ): 'update_base' | 'create_discount' {
    if (currentBasePrice === null) return 'update_base';
    if (newPrice >= currentBasePrice) return 'update_base';
    return 'create_discount';
  }
}
