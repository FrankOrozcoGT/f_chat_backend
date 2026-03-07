import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { DispatcherService } from '../../../nodes/services/dispatcher.service';

@Injectable()
export class LlmNode {
  private readonly logger = new Logger(LlmNode.name);

  constructor(
    private readonly dispatcher: DispatcherService,
    private readonly langSmithService: LangSmithService,
    private readonly limitsService: LimitsService,
    private readonly internalApi: InternalApiClient,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const {
      transcription,
      conversationId,
      messageId,
      messageType,
      imageUrl,
      userId,
      instanceName,
      clientPhone,
      apiCalls: existingApiCalls,
      totalCost: existingCost,
      error: previousError,
    } = state;

    if (previousError) return {};

    // Cargar historial de conversación
    const messages = await this.internalApi.getMessageHistory(
      conversationId,
      31,
    );
    const previousMessages = messages.slice(0, -1);
    const history = previousMessages
      .filter((m) => m.content)
      .map((m) => ({
        role: m.direction === 'incoming' ? 'user' : 'assistant',
        content: m.content,
      }));

    this.logger.log(
      `LlmNode: loaded ${history.length} messages from conversation history`,
    );

    try {
      const traceMessages = [
        ...history,
        {
          role: 'user',
          content: imageUrl
            ? `${transcription} [imagen: ${imageUrl}]`
            : transcription,
        },
      ];

      const dispatchResult = await this.langSmithService.traceLLM(
        () =>
          this.dispatcher.dispatch({
            conversationId,
            userId,
            transcription,
            imageUrl,
            history,
            instanceName,
            clientPhone,
          }),
        traceMessages,
      );

      const apiCall: CreateApiCallData = {
        messageId,
        apiType: 'kimi_llm',
        operation: 'chat',
        tokensInput: dispatchResult.tokensInput,
        tokensOutput: dispatchResult.tokensOutput,
        costUsd: dispatchResult.costUsd,
        latencyMs: dispatchResult.latencyMs,
      };

      // Incrementar créditos (input ponderado a 1/3)
      const actualCredits =
        this.limitsService.calculateCreditsFromLlm(
          dispatchResult.tokensInput,
          dispatchResult.tokensOutput,
        );
      await this.internalApi.incrementCreditsUsed(userId, actualCredits);
      this.logger.log(
        `LlmNode: incremented ${actualCredits.toFixed(3)} credits (${dispatchResult.tokensInput}in+${dispatchResult.tokensOutput}out)`,
      );

      const preferredFormat: 'audio' | 'text' =
        messageType === MessageType.voice || messageType === MessageType.audio
          ? 'audio'
          : 'text';

      this.logger.log(
        `LlmNode: intent=${dispatchResult.intent}, format=${preferredFormat}, response="${dispatchResult.response.substring(0, 80)}"`,
      );

      return {
        responseText: dispatchResult.response,
        intent: dispatchResult.intent,
        preferredFormat,
        apiCalls: [...existingApiCalls, apiCall],
        totalCost: existingCost + dispatchResult.costUsd,
      };
    } catch (error) {
      this.logger.error(`LlmNode: dispatch failed: ${error.message}`);
      return {
        error: { step: 'llm', apiName: 'kimi_llm', message: error.message },
      };
    }
  }
}
