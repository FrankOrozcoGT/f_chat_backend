import { Injectable, Logger } from '@nestjs/common';
import { QwenSttClient } from './clients/qwen-stt.client';
import { KimiClient } from './clients/kimi.client';
import { QwenTtsClient } from './clients/qwen-tts.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { SttResponse } from './clients/interfaces/stt-response.interface';
import { LlmResponse } from './clients/interfaces/llm-response.interface';
import { TtsResponse } from './clients/interfaces/tts-response.interface';
import { CreateApiCallData } from './repositories/ai.repository';

export interface AiProcessResult {
  audioBuffer: Buffer;
  responseText: string;
  intent: string;
  apiCalls: CreateApiCallData[];
  totalCost: number;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly sttClient: QwenSttClient,
    private readonly llmClient: KimiClient,
    private readonly ttsClient: QwenTtsClient,
    private readonly langSmithService: LangSmithService,
  ) {}

  async processAudioMessage(
    audioBuffer: Buffer,
    messageId: string,
    conversationId: string,
    clientPhone?: string,
  ): Promise<AiProcessResult> {
    return this.langSmithService.tracePipeline(
      async () => {
        const apiCalls: CreateApiCallData[] = [];

        // 1. STT: Audio → Text
        const sttResult: SttResponse = await this.langSmithService.traceSTT(
          () => this.sttClient.transcribe(audioBuffer),
        );
        apiCalls.push({
          messageId,
          apiType: 'qwen_stt',
          operation: 'transcribe',
          costUsd: sttResult.costUsd,
          latencyMs: sttResult.latencyMs,
        });

        // 2. LLM: Text → Response
        const llmResult: LlmResponse = await this.langSmithService.traceLLM(
          () => this.llmClient.chat(sttResult.text),
        );
        apiCalls.push({
          messageId,
          apiType: 'kimi_llm',
          operation: 'chat',
          tokensInput: llmResult.tokensInput,
          tokensOutput: llmResult.tokensOutput,
          costUsd: llmResult.costUsd,
          latencyMs: llmResult.latencyMs,
        });

        // 3. TTS: Response → Audio
        const ttsResult: TtsResponse = await this.langSmithService.traceTTS(
          () => this.ttsClient.synthesize(llmResult.response),
        );
        apiCalls.push({
          messageId,
          apiType: 'qwen_tts',
          operation: 'synthesize',
          costUsd: ttsResult.costUsd,
          latencyMs: ttsResult.latencyMs,
        });

        const totalCost = sttResult.costUsd + llmResult.costUsd + ttsResult.costUsd;

        this.logger.log(
          `AI pipeline completed: STT(${sttResult.latencyMs}ms) → LLM(${llmResult.latencyMs}ms) → TTS(${ttsResult.latencyMs}ms) | Total: $${totalCost.toFixed(6)}`,
        );

        return {
          audioBuffer: ttsResult.audioBuffer,
          responseText: llmResult.response,
          intent: llmResult.intent,
          apiCalls,
          totalCost,
        };
      },
      { conversationId, clientPhone, mode: 'AI' },
    );
  }
}
