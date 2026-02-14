import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { KimiClient } from '../../clients/kimi.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';

@Injectable()
export class LlmNode {
  private readonly logger = new Logger(LlmNode.name);

  constructor(
    private readonly kimiClient: KimiClient,
    private readonly langSmithService: LangSmithService,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const { transcription, messageId, messageType, apiCalls: existingApiCalls, totalCost: existingCost } = state;

    const llmResult = await this.langSmithService.traceLLM(
      () => this.kimiClient.chat(transcription),
    );

    const apiCall: CreateApiCallData = {
      messageId,
      apiType: 'kimi_llm',
      operation: 'chat',
      tokensInput: llmResult.tokensInput,
      tokensOutput: llmResult.tokensOutput,
      costUsd: llmResult.costUsd,
      latencyMs: llmResult.latencyMs,
    };

    // Decide preferred format: respond with audio if input was audio, text otherwise
    const preferredFormat: 'audio' | 'text' =
      messageType === MessageType.voice || messageType === MessageType.audio ? 'audio' : 'text';

    this.logger.log(`LlmNode: intent=${llmResult.intent}, format=${preferredFormat}, response="${llmResult.response.substring(0, 80)}"`);

    return {
      responseText: llmResult.response,
      intent: llmResult.intent,
      preferredFormat,
      apiCalls: [...existingApiCalls, apiCall],
      totalCost: existingCost + llmResult.costUsd,
    };
  }
}
