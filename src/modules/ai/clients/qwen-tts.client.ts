import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtsResponse } from './interfaces/tts-response.interface';

@Injectable()
export class QwenTtsClient {
  private readonly logger = new Logger(QwenTtsClient.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  // Pricing: $0.10 per 10K characters
  private static readonly COST_PER_CHAR = 0.10 / 10_000;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService.get<string>(
      'QWEN_TTS_API_URL',
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    this.apiKey = this.configService.get<string>('QWEN_API_KEY', '');
  }

  async synthesize(text: string): Promise<TtsResponse> {
    const startTime = Date.now();

    try {
      this.logger.log(`TTS request: ${text.length} chars, url=${this.apiUrl}, key=${this.apiKey.substring(0, 8)}...`);

      // 1. Request TTS generation
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen3-tts-flash',
          input: {
            text,
            voice: 'Cherry',
            language_type: 'Spanish',
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorHeaders = Object.fromEntries(response.headers.entries());
        throw new Error(`Qwen TTS API error ${response.status} ${response.statusText} | Headers: ${JSON.stringify(errorHeaders)} | Body: ${errorBody}`);
      }

      const data = await response.json();

      // 2. Download audio from returned URL
      const audioUrl = data.output?.audio?.url;
      if (!audioUrl) {
        throw new Error(`Qwen TTS: no audio URL in response: ${JSON.stringify(data)}`);
      }

      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        const dlErrorBody = await audioResponse.text();
        throw new Error(`Failed to download TTS audio: ${audioResponse.status} ${audioResponse.statusText} | Body: ${dlErrorBody}`);
      }

      const arrayBuffer = await audioResponse.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);
      const latencyMs = Date.now() - startTime;

      const costUsd = text.length * QwenTtsClient.COST_PER_CHAR;

      this.logger.log(`TTS completed: ${text.length} chars, ${audioBuffer.length} bytes, ${latencyMs}ms, $${costUsd.toFixed(6)}`);

      return { audioBuffer, costUsd, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`TTS failed after ${latencyMs}ms: ${error.message}`);
      throw error;
    }
  }
}
