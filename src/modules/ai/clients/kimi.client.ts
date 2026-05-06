import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ensureError } from '@common/utils/ensure-error';
import { LlmResponse } from './interfaces/llm-response.interface';
import { loadPrompt } from '@common/utils/load-prompt';
import { join } from 'path';

const PROMPTS_DIR = join(__dirname, '..', 'prompts');
const CHAT_SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'chat-system.md');

export class KimiApiError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'KimiApiError';
    if (cause) this.cause = cause;
  }
}

type ChatMessage = {
  role: string;
  content:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_call_id?: string;
  tool_calls?: any[];
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** Thrown by onToolCall to signal the loop should stop. */
export class ToolTermination {
  constructor(
    public readonly toolName: string,
    public readonly args: Record<string, unknown>,
  ) {}
}

export interface ToolChatResult {
  terminationTool: string | null;
  terminationArgs: Record<string, unknown> | null;
  terminationCallId: string | null;
  messagesAtTermination: ChatMessage[] | null;
  textResponse: string | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  latencyMs: number;
  iterations: number;
}

@Injectable()
export class KimiClient {
  private readonly logger = new Logger(KimiClient.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  // Pricing per 1M tokens: $0.95 input, $4.00 output
  private static readonly COST_PER_INPUT_TOKEN = 0.95 / 1_000_000;
  private static readonly COST_PER_OUTPUT_TOKEN = 4.0 / 1_000_000;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('KIMI_API_KEY', '');
    this.apiUrl = this.configService.get<string>(
      'KIMI_API_URL',
      'https://api.moonshot.ai/v1/chat/completions',
    );
  }

  async chat(
    text: string,
    history: { role: string; content: string }[] = [],
  ): Promise<LlmResponse> {
    const messages = [
      {
        role: 'system',
        content: CHAT_SYSTEM_PROMPT,
      },
      ...history,
      { role: 'user', content: text },
    ];

    const result = await this.rawChat(messages, 500);

    const intent = result.response.toLowerCase().includes('switch_hitl')
      ? 'switch_hitl'
      : 'normal';

    return {
      response:
        intent === 'switch_hitl'
          ? result.response.replace(/switch_hitl/gi, '').trim()
          : result.response,
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
        content: CHAT_SYSTEM_PROMPT,
      },
      ...history,
      { role: 'user', content: userContent },
    ];

    const result = await this.rawChat(messages, 500);

    const intent = result.response.toLowerCase().includes('switch_hitl')
      ? 'switch_hitl'
      : 'normal';

    return {
      response:
        intent === 'switch_hitl'
          ? result.response.replace(/switch_hitl/gi, '').trim()
          : result.response,
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
    maxRetries: number = 3,
  ): Promise<Omit<LlmResponse, 'intent'>> {
    const startTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'kimi-k2.6',
            messages,
            max_tokens: maxTokens,
            thinking: { type: 'disabled' },
          }),
        });

        const rateHeaders = {
          limitRequests: response.headers.get('x-ratelimit-limit-requests'),
          remainingRequests: response.headers.get('x-ratelimit-remaining-requests'),
          resetRequests: response.headers.get('x-ratelimit-reset-requests'),
          limitTokens: response.headers.get('x-ratelimit-limit-tokens'),
          remainingTokens: response.headers.get('x-ratelimit-remaining-tokens'),
        };
        if (rateHeaders.limitRequests) {
          this.logger.debug(`Rate limits: ${rateHeaders.remainingRequests}/${rateHeaders.limitRequests} requests, ${rateHeaders.remainingTokens}/${rateHeaders.limitTokens} tokens, reset: ${rateHeaders.resetRequests}`);
        }

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') ?? '', 10);
          const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * Math.pow(2, attempt), 30000);
          if (attempt < maxRetries) {
            this.logger.warn(`LLM rate limited (429), retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`);
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
        }

        if (!response.ok) {
          const errorBody = await response.text();
          const errorHeaders = Object.fromEntries(response.headers.entries());
          throw new KimiApiError(
            `Kimi API error ${response.status} ${response.statusText} | Headers: ${JSON.stringify(errorHeaders)} | Body: ${errorBody}`,
          );
        }

        const data = await response.json();
        const latencyMs = Date.now() - startTime;

        const responseText = data.choices?.[0]?.message?.content || '';
        const tokensInput = data.usage?.prompt_tokens || 0;
        const tokensOutput = data.usage?.completion_tokens || 0;

        const costUsd =
          tokensInput * KimiClient.COST_PER_INPUT_TOKEN +
          tokensOutput * KimiClient.COST_PER_OUTPUT_TOKEN;

        this.logger.log(
          `LLM completed: ${tokensInput}+${tokensOutput} tokens, ${latencyMs}ms, $${costUsd.toFixed(6)}`,
        );

        return {
          response: responseText,
          tokensInput,
          tokensOutput,
          costUsd,
          latencyMs,
        };
      } catch (e) {
        if (attempt === maxRetries || !(e instanceof KimiApiError)) {
          const error = ensureError(e);
          const latencyMs = Date.now() - startTime;
          this.logger.error(`LLM failed after ${latencyMs}ms: ${error.message} | cause=${error.cause} | type=${error.constructor?.name}`);
          throw e;
        }
      }
    }

    throw new KimiApiError('LLM failed: max retries exhausted');
  }

  async chatWithTools(params: {
    messages: ChatMessage[];
    tools: ToolDefinition[];
    onToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
    maxTokens?: number;
    maxIterations?: number;
  }): Promise<ToolChatResult> {
    const {
      messages,
      tools,
      onToolCall,
      maxTokens = 500,
      maxIterations = 10,
    } = params;

    const conversationMessages: ChatMessage[] = [...messages];
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    const startTime = Date.now();

    for (let i = 0; i < maxIterations; i++) {
      const body = JSON.stringify({
        model: 'kimi-k2.6',
        messages: conversationMessages,
        tools,
        tool_choice: 'required',
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
      });
      this.logger.log(`chatWithTools iter=${i} payload=${(body.length / 1024).toFixed(1)}KB msgs=${conversationMessages.length}`);

      let response: Response;
      try {
        response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
        });
      } catch (e) {
        const error = ensureError(e);
        this.logger.error(`chatWithTools fetch failed at iter=${i}:`, error);
        throw new KimiApiError(error.message, error.cause);
      }

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') ?? '', 10);
        const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(3000 * Math.pow(2, i), 30000);
        this.logger.warn(`chatWithTools 429 at iter=${i}, retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        i--; // retry same iteration
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        const prevTools = conversationMessages
          .filter((m) => m.role === 'tool')
          .map((m) => m.tool_call_id)
          .length;
        this.logger.error(
          `chatWithTools failed at iter=${i}, status=${response.status}, payload=${(body.length / 1024).toFixed(1)}KB, msgs=${conversationMessages.length}, toolCallsSoFar=${prevTools}, body=${errorBody}`,
        );
        throw new KimiApiError(`Kimi API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      totalTokensInput += data.usage?.prompt_tokens || 0;
      totalTokensOutput += data.usage?.completion_tokens || 0;

      const choice = data.choices?.[0];
      const assistantMessage = choice?.message;
      if (!assistantMessage) {
        throw new Error('No assistant message in Kimi response');
      }

      conversationMessages.push(assistantMessage);

      const toolCalls = assistantMessage.tool_calls;

      // No tool calls → plain text response
      if (!toolCalls || toolCalls.length === 0) {
        const latencyMs = Date.now() - startTime;
        const costUsd =
          totalTokensInput * KimiClient.COST_PER_INPUT_TOKEN +
          totalTokensOutput * KimiClient.COST_PER_OUTPUT_TOKEN;

        this.logger.log(
          `chatWithTools: text response at iteration ${i}. ${totalTokensInput}+${totalTokensOutput} tokens`,
        );

        return {
          terminationTool: null,
          terminationArgs: null,
          terminationCallId: null,
          messagesAtTermination: null,
          textResponse: assistantMessage.content || '',
          tokensInput: totalTokensInput,
          tokensOutput: totalTokensOutput,
          costUsd,
          latencyMs,
          iterations: i + 1,
        };
      }

      for (const toolCall of toolCalls) {
        const fnName = toolCall.function?.name;
        const fnArgs = JSON.parse(toolCall.function?.arguments || '{}');
        this.logger.log(`chatWithTools iter=${i} tool=${fnName} args=${JSON.stringify(fnArgs).slice(0, 200)}`);

        try {
          const toolResult = await onToolCall(fnName, fnArgs);
          conversationMessages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: toolCall.id,
          });
        } catch (e) {
          if (e instanceof ToolTermination) {
            const latencyMs = Date.now() - startTime;
            const costUsd =
              totalTokensInput * KimiClient.COST_PER_INPUT_TOKEN +
              totalTokensOutput * KimiClient.COST_PER_OUTPUT_TOKEN;

            this.logger.log(
              `chatWithTools: terminated via "${e.toolName}" at iteration ${i}. ${totalTokensInput}+${totalTokensOutput} tokens`,
            );

            return {
              terminationTool: e.toolName,
              terminationArgs: e.args,
              terminationCallId: toolCall.id,
              messagesAtTermination: [...conversationMessages],
              textResponse: null,
              tokensInput: totalTokensInput,
              tokensOutput: totalTokensOutput,
              costUsd,
              latencyMs,
              iterations: i + 1,
            };
          }
          throw e;
        }
      }
    }

    const latencyMs = Date.now() - startTime;
    const costUsd =
      totalTokensInput * KimiClient.COST_PER_INPUT_TOKEN +
      totalTokensOutput * KimiClient.COST_PER_OUTPUT_TOKEN;

    this.logger.warn(
      `chatWithTools: max iterations (${maxIterations}) reached. ${totalTokensInput}+${totalTokensOutput} tokens`,
    );

    return {
      terminationTool: null,
      terminationArgs: null,
      terminationCallId: null,
      messagesAtTermination: null,
      textResponse: null,
      tokensInput: totalTokensInput,
      tokensOutput: totalTokensOutput,
      costUsd,
      latencyMs,
      iterations: maxIterations,
    };
  }
}
