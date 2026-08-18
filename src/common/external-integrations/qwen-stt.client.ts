import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SttResponse } from './interfaces/stt-response.interface';

@Injectable()
export class QwenSttClient {
  private readonly logger = new Logger(QwenSttClient.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  // Pricing: $0.00009 per second
  private static readonly COST_PER_SECOND = 0.00009;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('QWEN_API_KEY', '');
    this.apiUrl = this.configService.get<string>(
      'QWEN_STT_API_URL',
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
  }

  async transcribe(audioBuffer: Buffer): Promise<SttResponse> {
    const startTime = Date.now();

    try {
      // Send OGA/OGG directly as base64 data URI — no conversion needed
      const base64Audio = audioBuffer.toString('base64');
      const audioDataUri = `data:audio/ogg;base64,${base64Audio}`;

      this.logger.log(
        `STT request: ${audioBuffer.length} bytes, url=${this.apiUrl}, key=${this.apiKey.substring(0, 8)}...`,
      );

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen3-asr-flash',
          input: {
            messages: [
              { content: [{ text: '' }], role: 'system' },
              { content: [{ audio: audioDataUri }], role: 'user' },
            ],
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorHeaders = Object.fromEntries(response.headers.entries());
        throw new Error(
          `STT API error ${response.status} ${response.statusText} | Headers: ${JSON.stringify(errorHeaders)} | Body: ${errorBody}`,
        );
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      const transcript =
        data.output?.choices?.[0]?.message?.content?.[0]?.text || '';
      const durationSeconds =
        data.usage?.audio_duration || audioBuffer.length / 2000;
      const costUsd = durationSeconds * QwenSttClient.COST_PER_SECOND;

      this.logger.log(
        `STT completed: "${transcript.substring(0, 80)}" ${latencyMs}ms, $${costUsd.toFixed(6)}`,
      );

      return { text: transcript, costUsd, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`STT failed after ${latencyMs}ms: ${error.message}`);
      throw error;
    }
  }
}
