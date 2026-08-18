import { Injectable, Logger } from '@nestjs/common';
import { KimiClient } from '@common/external-integrations/kimi.client';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { loadPrompt } from '@common/utils/load-prompt';
import { join } from 'path';
import {
  AnalysisStateType,
  AnalysisLlmOutput,
  SubConversation,
  AnalysisProduct,
  AnalysisPromotion,
  InternalParticipant,
} from '../analysis-state.interface';

const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');
const SECTIONS_DIR = join(PROMPTS_DIR, 'sections');

const BASE_PROMPT = loadPrompt(PROMPTS_DIR, 'analysis-system.md');
const INTERNAL_INDIVIDUAL = loadPrompt(SECTIONS_DIR, 'internal-individual.md');
const INTERNAL_INDIVIDUAL_KNOWN = loadPrompt(SECTIONS_DIR, 'internal-individual-known.md');
const INTERNAL_GROUP = loadPrompt(SECTIONS_DIR, 'internal-group.md');
const OUTPUT_STANDARD = loadPrompt(SECTIONS_DIR, 'output-standard.md');
const OUTPUT_KNOWN_INTERNAL = loadPrompt(SECTIONS_DIR, 'output-known-internal.md');

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
    const { processedMessages, tenantId, totalCost, existingIntents, isGroup, knownInternal } = state;

    const messagesText = processedMessages
      .map((m) => {
        let sender: string;
        if (m.direction === 'outgoing') {
          sender = 'Negocio';
        } else if (isGroup && m.metadata?.senderName) {
          sender = `${m.metadata.senderName} (${m.metadata.senderJid ?? ''})`;
        } else if (m.metadata?.senderJid) {
          sender = `Cliente (${m.metadata.senderJid})`;
        } else {
          sender = 'Cliente';
        }
        const time = new Date(m.createdAt).toLocaleString('es-MX');
        const text = m.transcription || m.content || '[sin contenido]';
        return `[${time}] ${sender} (id:${m.id}): ${text}`;
      })
      .join('\n');

    // Armar prompt dinámico
    let internalSection: string;
    let outputSection: string;

    if (knownInternal) {
      internalSection = INTERNAL_INDIVIDUAL_KNOWN;
      outputSection = OUTPUT_KNOWN_INTERNAL;
    } else if (isGroup) {
      internalSection = INTERNAL_GROUP;
      outputSection = OUTPUT_STANDARD;
    } else {
      internalSection = INTERNAL_INDIVIDUAL;
      outputSection = OUTPUT_STANDARD;
    }

    const systemPrompt = BASE_PROMPT
      .replace('{{INTERNAL_SECTION}}', internalSection)
      .replace('{{OUTPUT_SECTION}}', outputSection);

    const intentsSection = existingIntents.length > 0
      ? `\n\nIntenciones ya detectadas en conversaciones anteriores (reutiliza si aplica): ${existingIntents.join(', ')}\n`
      : '';

    const userPrompt = `Analiza la siguiente conversación de WhatsApp y divídela en sub-conversaciones:${intentsSection}\n${messagesText}`;

    const result = await this.kimiClient.rawChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      8000,
    );

    const llmCredits = this.limitsService.calculateCreditsFromTokens(
      result.tokensInput + result.tokensOutput,
    );
    await this.internalApi.incrementCreditsUsed(tenantId, llmCredits);

    const parsed = this.parseResponse(result.response, knownInternal);

    this.logger.log(
      `AnalysisNode: ${parsed.subConversations.length} sub-conversations, ${parsed.products.length} products, ${parsed.participants.length} participants, cost=$${result.costUsd.toFixed(6)}`,
    );

    return {
      realName: parsed.realName,
      subConversations: parsed.subConversations,
      products: parsed.products,
      promotions: parsed.promotions,
      isInternal: parsed.isInternal,
      internalPurpose: parsed.internalPurpose,
      channelName: parsed.channelName,
      participants: parsed.participants,
      intentRenames: parsed.intentRenames,
      totalCost: totalCost + result.costUsd,
    };
  }

  private parseResponse(response: string, knownInternal: boolean): AnalysisLlmOutput {
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
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      if (!parsed.subConversations || !Array.isArray(parsed.subConversations)) {
        throw new Error('Response missing subConversations array');
      }

      const isInternal = knownInternal ? true : parsed.isInternal;
      if (typeof isInternal !== 'boolean') {
        throw new Error('LLM response missing required field: isInternal');
      }

      const rawParticipants = parsed.participants as Record<string, unknown>[] | undefined;
      const participants: InternalParticipant[] = Array.isArray(rawParticipants)
        ? rawParticipants
            .filter((p): p is Record<string, string> => !!(p.senderJid && p.channelName && p.internalPurpose))
            .map((p) => ({
              senderJid: p.senderJid,
              channelName: p.channelName,
              internalPurpose: p.internalPurpose,
            }))
        : [];

      const rawSubConversations = parsed.subConversations as Record<string, unknown>[];
      const subConversations: SubConversation[] = rawSubConversations.map((s) => ({
        summary: s.summary as string,
        firstMessageId: s.firstMessageId as string,
        lastMessageId: s.lastMessageId as string,
        intent: (s.intent as string) ?? null,
        intentDescription: (s.intentDescription as string) ?? null,
        flowSummary: (s.flowSummary as string) ?? null,
        flowDiagram: (s.flowDiagram as string) ?? null,
      }));

      const rawIntentRenames = parsed.intentRenames as { from: string; to: string }[] | undefined;

      return {
        realName: (parsed.realName as string) ?? null,
        subConversations,
        products: (parsed.products as AnalysisProduct[]) ?? [],
        promotions: (parsed.promotions as AnalysisPromotion[]) ?? [],
        isInternal,
        internalPurpose: (parsed.internalPurpose as string) ?? null,
        channelName: (parsed.channelName as string) ?? null,
        participants,
        intentRenames: Array.isArray(rawIntentRenames)
          ? rawIntentRenames.filter((r) => r.from && r.to && r.from !== r.to)
          : [],
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
