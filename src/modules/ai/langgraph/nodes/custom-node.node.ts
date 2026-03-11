import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { DispatcherService } from '../../../nodes/services/dispatcher.service';
import { NodeRepository } from '../../../nodes/repositories/node.repository';
import { NodeSessionRepository } from '../../../nodes/repositories/node-session.repository';

@Injectable()
export class CustomNode {
  private readonly logger = new Logger(CustomNode.name);

  constructor(
    private readonly dispatcher: DispatcherService,
    private readonly nodeRepo: NodeRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
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
      currentNodeId,
      apiCalls: existingApiCalls,
      totalCost: existingCost,
      error: previousError,
    } = state;

    if (previousError) return {};

    if (!currentNodeId) {
      throw new Error(
        `CustomNode: currentNodeId is null for conversation ${conversationId}. ` +
        `This node should only be reached when a flow has been activated.`,
      );
    }

    // Load history
    const messages = await this.internalApi.getMessageHistory(conversationId, 31);
    const previousMessages = messages.slice(0, -1);
    const history = previousMessages
      .filter((m) => m.content)
      .map((m) => ({
        role: m.direction === 'incoming' ? 'user' : 'assistant',
        content: m.content,
      }));

    this.logger.log(
      `CustomNode: dispatching to node ${currentNodeId} for conversation ${conversationId}`,
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
            messageId,
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

      const actualCredits = this.limitsService.calculateCreditsFromLlm(
        dispatchResult.tokensInput,
        dispatchResult.tokensOutput,
      );
      await this.internalApi.incrementCreditsUsed(userId, actualCredits);
      this.logger.log(
        `CustomNode: incremented ${actualCredits.toFixed(3)} credits (${dispatchResult.tokensInput}in+${dispatchResult.tokensOutput}out)`,
      );

      const preferredFormat: 'audio' | 'text' =
        messageType === MessageType.voice || messageType === MessageType.audio
          ? 'audio'
          : 'text';

      this.logger.log(
        `CustomNode: intent=${dispatchResult.intent}, format=${preferredFormat}, response="${dispatchResult.response.substring(0, 80)}"`,
      );

      return {
        responseText: dispatchResult.response,
        intent: dispatchResult.intent,
        preferredFormat,
        apiCalls: [...existingApiCalls, apiCall],
        totalCost: existingCost + dispatchResult.costUsd,
      };
    } catch (error) {
      this.logger.error(`CustomNode: dispatch failed: ${error.message}`);
      return {
        error: { step: 'custom_node', apiName: 'kimi_llm', message: error.message },
      };
    }
  }
}
