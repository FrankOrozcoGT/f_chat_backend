import { Injectable, Logger } from '@nestjs/common';
import { KimiClient } from '@modules/ai/clients/kimi.client';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '@modules/ai/clients/internal-api.client';
import { loadPrompt } from '@common/utils/load-prompt';
import { join } from 'path';
import {
  AnalysisStateType,
  AnalysisLlmOutput,
} from '../analysis-state.interface';

const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');
const ANALYSIS_SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'analysis-system.md');

@Injectable()
export class AnalysisNode {
  private readonly logger = new Logger(AnalysisNode.name);

  constructor(
    private readonly kimiClient: KimiClient,
    private readonly limitsService: LimitsService,
    private readonly internalApi: InternalApiClient,
  ) {}

  async execute(
    state: AnalysisStateType,
  ): Promise<Partial<AnalysisStateType>> {
    const { processedMessages, tenantId, totalCost, existingIntents, isGroup } = state;

    const messagesText = processedMessages
      .map((m) => {
        let sender: string;
        if (m.direction === 'outgoing') {
          sender = 'Negocio';
        } else if (isGroup && m.metadata?.senderName) {
          sender = m.metadata.senderName;
        } else {
          sender = 'Cliente';
        }
        const time = new Date(m.createdAt).toLocaleString('es-MX');
        const text = m.transcription || m.content || '[sin contenido]';
        return `[${time}] ${sender} (id:${m.id}): ${text}`;
      })
      .join('\n');

    const intentsSection = existingIntents.length > 0
      ? `\n\nIntenciones ya detectadas en conversaciones anteriores (reutiliza si aplica): ${existingIntents.join(', ')}\n`
      : '';

    const userPrompt = `Analiza la siguiente conversación de WhatsApp y divídela en sub-conversaciones:${intentsSection}\n${messagesText}`;

    const result = await this.kimiClient.rawChat(
      [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      8000,
    );

    const llmCredits = this.limitsService.calculateCreditsFromTokens(
      result.tokensInput + result.tokensOutput,
    );
    await this.internalApi.incrementCreditsUsed(tenantId, llmCredits);

    const parsed = this.parseResponse(result.response);

    this.logger.log(
      `AnalysisNode: ${parsed.subConversations.length} sub-conversations, ${parsed.products.length} products, ${parsed.promotions.length} promotions, cost=$${result.costUsd.toFixed(6)}`,
    );

    return {
      realName: parsed.realName,
      subConversations: parsed.subConversations,
      products: parsed.products,
      promotions: parsed.promotions,
      isInternal: parsed.isInternal,
      internalPurpose: parsed.internalPurpose,
      channelName: parsed.channelName,
      totalCost: totalCost + result.costUsd,
    };
  }

  private parseResponse(response: string): AnalysisLlmOutput {
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed.subConversations || !Array.isArray(parsed.subConversations)) {
        throw new Error('Response missing subConversations array');
      }
      if (typeof parsed.isInternal !== 'boolean') {
        throw new Error('LLM response missing required field: isInternal');
      }
      return {
        realName: parsed.realName ?? null,
        subConversations: parsed.subConversations.map((s: any) => ({
          summary: s.summary,
          firstMessageId: s.firstMessageId,
          lastMessageId: s.lastMessageId,
          intent: s.intent ?? null,
          flowSummary: s.flowSummary ?? null,
          flowDiagram: s.flowDiagram ?? null,
        })),
        products: parsed.products ?? [],
        promotions: parsed.promotions ?? [],
        isInternal: parsed.isInternal,
        internalPurpose: parsed.internalPurpose ?? null,
        channelName: parsed.channelName ?? null,
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse LLM response: ${error.message}. Raw: ${response.substring(0, 200)}`,
      );
      throw new Error(
        `LLM returned invalid JSON for analysis: ${error.message}`,
      );
    }
  }
}
