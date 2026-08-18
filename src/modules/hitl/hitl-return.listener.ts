import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { ConversationAnalysisService } from '@modules/conversation-analysis/conversation-analysis.service';
import { IntentRepository } from '@modules/nodes/repositories/intent.repository';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { NodeSessionRepository } from '@modules/nodes/repositories/node-session.repository';
import { KimiClient } from '@common/external-integrations/kimi.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';

export interface HitlReturnEvent {
  conversationId: string;
  tenantId: string;
  messageCount: number;
  lastMessageDirection: string;
  lastMessage: {
    id: string;
    direction: string;
    type: string;
    content: string | null;
    transcription?: string | null;
    mediaUrl?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
  };
}

@Injectable()
export class HitlReturnListener {
  private readonly logger = new Logger(HitlReturnListener.name);

  constructor(
    private readonly internalApi: InternalApiClient,
    private readonly analysisService: ConversationAnalysisService,
    private readonly intentRepo: IntentRepository,
    private readonly nodeRepo: NodeRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly kimiClient: KimiClient,
    private readonly langSmith: LangSmithService,
    private readonly phoneRepo: PhoneRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('ai.hitl.return')
  async handle(event: HitlReturnEvent): Promise<void> {
    const { conversationId, tenantId, messageCount, lastMessageDirection, lastMessage } = event;

    this.logger.log(
      `[hitl.return] conversationId=${conversationId} messageCount=${messageCount} lastDir=${lastMessageDirection}`,
    );

    try {
      const conversation = await this.internalApi.getConversationFull(conversationId);

      // 1. Run analysis only if ≥5 messages
      let analysisRemainingCount: number | null = null;
      if (messageCount >= 5 && conversation.client) {
        try {
          const analysisResult = await this.analysisService.runAnalysis(
            { id: conversation.id, phoneId: conversation.phoneId, phone: conversation.phone, client: conversation.client },
            tenantId,
          );
          analysisRemainingCount = analysisResult.remainingCount;
          if (analysisResult.lastMessageTranscription) {
            lastMessage.transcription = analysisResult.lastMessageTranscription;
          }
          this.logger.log(`[hitl.return] Analysis completed for ${conversationId}, remainingCount=${analysisRemainingCount}`);
        } catch (err) {
          this.logger.error(`[hitl.return] Analysis failed: ${err.message}`);
          throw err;
        }
      }

      // If analysis ran and left 0 messages → wait for client
      if (analysisRemainingCount === 0) {
        this.logger.log(`[hitl.return] Analysis moved all messages → waiting for client`);
        return;
      }

      // 2. Detect intent with LLM
      const messages = await this.internalApi.getMessageHistory(conversationId, 20);
      const intents = await this.intentRepo.findByTenantId(tenantId);

      if (intents.length === 0) {
        this.logger.log(`[hitl.return] No intents configured`);
        return this.dispatchOrWait(lastMessageDirection, lastMessage, conversation, tenantId, conversationId);
      }

      const history = messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.direction === 'incoming' ? 'user' : 'assistant', content: m.content }));

      const intentList = intents.map((i) => `- ${i.name}`).join('\n');
      const systemPrompt = `Eres un clasificador de intenciones. Analiza la conversación y determina si hay una intención clara del cliente.

Intenciones disponibles:
${intentList}

Responde ÚNICAMENTE con el nombre exacto de la intención si la detectas claramente, o con "ninguna" si no hay intención clara o la conversación es solo saludo/despedida.`;

      const llmMessages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: `¿Cuál es la intención del cliente? Responde solo con el nombre de la intención o "ninguna".` },
      ];

      const result = await this.langSmith.traceLLM(
        () => this.kimiClient.rawChat(llmMessages, 100),
        history,
      );

      const rawResponse = result.response?.trim().toLowerCase() ?? 'ninguna';
      this.logger.log(`[hitl.return] Intent detected: "${rawResponse}"`);

      if (rawResponse !== 'ninguna') {
        const matched = intents.find(
          (i) => i.name.toLowerCase() === rawResponse || rawResponse.includes(i.name.toLowerCase()),
        );

        if (matched?.flowId) {
          // 3. Position node session
          const activeSession = await this.nodeSessionRepo.findActiveOrWaitingByConversationId(conversationId);

          if (!activeSession?.currentNodeId || activeSession.flowId !== matched.flowId) {
            const flow = await this.nodeRepo.findFlowWithNodes(matched.flowId);
            if (flow) {
              this.logger.log(`[hitl.return] Flow "${matched.name}" positioned at routerNode=${flow.routerNodeId}`);
            }
          } else {
            this.logger.log(`[hitl.return] Resuming at node=${activeSession.currentNodeId}`);
          }
        }
      }

      // 4. Dispatch or wait depending on last message direction
      return this.dispatchOrWait(lastMessageDirection, lastMessage, conversation, tenantId, conversationId);
    } catch (err) {
      this.logger.error(`[hitl.return] Failed: ${err.message}`);
    }
  }

  private async dispatchOrWait(
    lastMessageDirection: string,
    lastMessage: HitlReturnEvent['lastMessage'],
    conversation: Awaited<ReturnType<InternalApiClient['getConversationFull']>>,
    tenantId: string,
    conversationId: string,
  ): Promise<void> {
    if (lastMessageDirection !== 'incoming') {
      this.logger.log(`[hitl.return] Last message is ours → waiting for client`);
      return;
    }

    if (!conversation.client) {
      throw new Error(`[hitl.return] Cannot dispatch AI: conversation ${conversationId} has no client`);
    }

    const phone = await this.phoneRepo.findById(conversation.phoneId);
    if (!phone) {
      throw new Error(`[hitl.return] Cannot dispatch AI: phone ${conversation.phoneId} not found`);
    }

    this.logger.log(`[hitl.return] Dispatching ai.incoming.message for ${conversationId}`);

    this.eventEmitter.emit('ai.incoming.message', {
      messageId: lastMessage.id,
      conversationId,
      instanceName: phone.evolutionInstanceId,
      clientPhone: conversation.client.phoneNumber,
      tenantId,
      messageType: lastMessage.type,
      content: lastMessage.content ?? null,
      transcription: lastMessage.transcription ?? null,
      mediaRelativePath: lastMessage.mediaUrl ?? null,
      mediaMetadata: lastMessage.fileName
        ? { fileName: lastMessage.fileName, mimeType: lastMessage.mimeType }
        : null,
      fromHitl: true,
    });
  }
}
