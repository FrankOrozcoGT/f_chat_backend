import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmResponse } from './interfaces/llm-response.interface';

type ChatMessage = {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

@Injectable()
export class KimiClient {
  private readonly logger = new Logger(KimiClient.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  // Pricing per 1M tokens: $0.60 input, $2.50 output
  private static readonly COST_PER_INPUT_TOKEN = 0.60 / 1_000_000;
  private static readonly COST_PER_OUTPUT_TOKEN = 2.50 / 1_000_000;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('KIMI_API_KEY', '');
    this.apiUrl = this.configService.get<string>('KIMI_API_URL', 'https://api.moonshot.ai/v1/chat/completions');
  }

  async chat(text: string, history: { role: string; content: string }[] = []): Promise<LlmResponse> {
    const messages = [
      {
        role: 'system',
        content: 'Eres un asistente de voz amigable y conciso. Responde en español de forma natural y breve, como si estuvieras hablando por teléfono. Si el usuario quiere hablar con un humano, responde con el intent "switch_hitl".',
      },
      ...history,
      { role: 'user', content: text },
    ];

    const result = await this.rawChat(messages, 500);

    const intent = result.response.toLowerCase().includes('switch_hitl') ? 'switch_hitl' : 'normal';

    return {
      response: intent === 'switch_hitl' ? result.response.replace(/switch_hitl/gi, '').trim() : result.response,
      intent,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    };
  }

  async chatWithVision(
    text: string,
    imageUrl: string,
    history: ChatMessage[] = [],
  ): Promise<LlmResponse> {
    const userContent = [
      { type: 'text', text: text || 'Describe esta imagen.' },
      { type: 'image_url', image_url: { url: imageUrl } },
    ];

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Eres un asistente amigable y conciso. Responde en español. Si el usuario envía una imagen, descríbela y responde a cualquier pregunta sobre ella. Si el usuario quiere hablar con un humano, responde con el intent "switch_hitl".',
      },
      ...history,
      { role: 'user', content: userContent },
    ];

    const result = await this.rawChat(messages, 500);

    const intent = result.response.toLowerCase().includes('switch_hitl') ? 'switch_hitl' : 'normal';

    return {
      response: intent === 'switch_hitl' ? result.response.replace(/switch_hitl/gi, '').trim() : result.response,
      intent,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    };
  }

  async rawChat(
    messages: ChatMessage[],
    maxTokens: number = 500,
  ): Promise<Omit<LlmResponse, 'intent'>> {
    const startTime = Date.now();

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'kimi-k2.5',
          messages,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorHeaders = Object.fromEntries(response.headers.entries());
        throw new Error(`Kimi API error ${response.status} ${response.statusText} | Headers: ${JSON.stringify(errorHeaders)} | Body: ${errorBody}`);
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      const responseText = data.choices?.[0]?.message?.content || '';
      const tokensInput = data.usage?.prompt_tokens || 0;
      const tokensOutput = data.usage?.completion_tokens || 0;

      const costUsd =
        tokensInput * KimiClient.COST_PER_INPUT_TOKEN +
        tokensOutput * KimiClient.COST_PER_OUTPUT_TOKEN;

      this.logger.log(`LLM completed: ${tokensInput}+${tokensOutput} tokens, ${latencyMs}ms, $${costUsd.toFixed(6)}`);

      return { response: responseText, tokensInput, tokensOutput, costUsd, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`LLM failed after ${latencyMs}ms: ${error.message}`);
      throw error;
    }
  }
}
