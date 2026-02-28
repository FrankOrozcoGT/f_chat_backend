import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { KimiClient } from '../../clients/kimi.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { LlmResponse } from '../../clients/interfaces/llm-response.interface';

@Injectable()
export class LlmNode {
  private readonly logger = new Logger(LlmNode.name);

  constructor(
    private readonly kimiClient: KimiClient,
    private readonly langSmithService: LangSmithService,
    private readonly prisma: PrismaService,
    private readonly limitsService: LimitsService,
    private readonly conversationRepository: ConversationRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const {
      transcription,
      contextForLlm,
      conversationId,
      messageId,
      messageType,
      imageUrl,
      apiCalls: existingApiCalls,
      totalCost: existingCost,
      error: previousError,
    } = state;

    // Si un node anterior falló, skip
    if (previousError) return {};

    // Flujo complejo: usa contextForLlm del ContextBuilderNode
    // Flujo simple: carga historial de la conversación desde DB
    let history: { role: string; content: string }[] = [];

    if (contextForLlm) {
      // Flujo complejo: context builder ya armó el contexto
      history = [{ role: 'user', content: contextForLlm }];
    } else {
      // Flujo simple: cargar últimos 30 mensajes de la conversación
      const messages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 31, // 30 + 1 (el mensaje actual)
        select: { content: true, direction: true },
      });

      // Reverse para orden cronológico, excluir el último (mensaje actual)
      const previousMessages = messages.reverse().slice(0, -1);

      history = previousMessages
        .filter((m) => m.content)
        .map((m) => ({
          role: m.direction === 'incoming' ? 'user' : 'assistant',
          content: m.content,
        }));

      this.logger.log(
        `LlmNode: loaded ${history.length} messages from conversation history`,
      );
    }

    // Validar créditos ANTES de llamar a LLM
    const conversation =
      await this.conversationRepository.findByIdWithRelations(conversationId);
    if (!conversation) {
      return {
        error: {
          step: 'llm',
          apiName: 'kimi_llm',
          message: 'Conversation not found',
        },
      };
    }
    const userId = conversation.phone.userId;

    // NO validar créditos - permitir que el flujo se complete aunque quede en negativo
    // La deuda se arrastrará al siguiente periodo de facturación
    this.logger.log(
      `LlmNode: processing for user ${userId} (no credit validation)`,
    );

    try {
      let llmResult: LlmResponse;

      const traceMessages = [
        ...history,
        {
          role: 'user',
          content: imageUrl
            ? `${transcription} [imagen: ${imageUrl}]`
            : transcription,
        },
      ];

      if (imageUrl) {
        llmResult = await this.langSmithService.traceLLM(
          () =>
            this.kimiClient.chatWithVision(transcription, imageUrl, history),
          traceMessages,
        );
      } else {
        llmResult = await this.langSmithService.traceLLM(
          () => this.kimiClient.chat(transcription, history),
          traceMessages,
        );
      }

      const apiCall: CreateApiCallData = {
        messageId,
        apiType: 'kimi_llm',
        operation: 'chat',
        tokensInput: llmResult.tokensInput,
        tokensOutput: llmResult.tokensOutput,
        costUsd: llmResult.costUsd,
        latencyMs: llmResult.latencyMs,
      };

      // Incrementar créditos usados basado en tokens reales
      const totalTokens = llmResult.tokensInput + llmResult.tokensOutput;
      const actualCredits =
        this.limitsService.calculateCreditsFromTokens(totalTokens);
      await this.userRepository.incrementCreditsUsed(userId, actualCredits);
      this.logger.log(
        `LlmNode: incremented ${actualCredits.toFixed(3)} credits (${totalTokens} tokens)`,
      );

      // Decide preferred format: respond with audio if input was audio, text otherwise
      const preferredFormat: 'audio' | 'text' =
        messageType === MessageType.voice || messageType === MessageType.audio
          ? 'audio'
          : 'text';

      this.logger.log(
        `LlmNode: intent=${llmResult.intent}, format=${preferredFormat}, response="${llmResult.response.substring(0, 80)}"`,
      );

      return {
        responseText: llmResult.response,
        intent: llmResult.intent,
        preferredFormat,
        apiCalls: [...existingApiCalls, apiCall],
        totalCost: existingCost + llmResult.costUsd,
      };
    } catch (error) {
      this.logger.error(`LlmNode: Kimi LLM failed: ${error.message}`);
      return {
        error: { step: 'llm', apiName: 'kimi_llm', message: error.message },
      };
    }
  }
}
