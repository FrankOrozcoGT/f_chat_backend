import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { KimiClient } from '@modules/ai/clients/kimi.client';
import { loadPrompt } from '@common/utils/load-prompt';

const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');
const SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'intent-classifier-system.md');

@Injectable()
export class IntentClassifierNode {
  private readonly logger = new Logger(IntentClassifierNode.name);

  constructor(private readonly kimiClient: KimiClient) {}

  async classify(input: {
    rawIntents: string[];
    existingIntents: string[];
  }): Promise<Map<string, string>> {
    if (input.rawIntents.length === 0) {
      return new Map();
    }

    const userPrompt = this.buildUserPrompt(input);

    const result = await this.kimiClient.rawChat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      1000,
    );

    const map = this.parseResponse(result.response, input.rawIntents);

    this.logger.log(
      `IntentClassifierNode: ${input.rawIntents.length} intents → ${new Set(map.values()).size} grupos, $${result.costUsd.toFixed(6)}`,
    );

    return map;
  }

  private buildUserPrompt(input: { rawIntents: string[]; existingIntents: string[] }): string {
    const parts: string[] = [];

    parts.push(`## Intenciones crudas detectadas (${input.rawIntents.length}):`);
    parts.push(input.rawIntents.map((r) => `- ${r}`).join('\n'));

    if (input.existingIntents.length > 0) {
      parts.push(`\n## Intenciones ya existentes en el sistema (priorizar estos nombres):`);
      parts.push(input.existingIntents.map((e) => `- ${e}`).join('\n'));
    } else {
      parts.push(`\n## Intenciones ya existentes en el sistema: ninguna`);
    }

    parts.push(`\nNormaliza las intenciones crudas según las reglas.`);

    return parts.join('\n');
  }

  private parseResponse(response: string, rawIntents: string[]): Map<string, string> {
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      throw new Error(`IntentClassifierNode: LLM returned invalid JSON: ${error.message}. Raw: ${response.substring(0, 300)}`);
    }

    if (!Array.isArray(parsed.mappings)) {
      throw new Error(`IntentClassifierNode: response missing mappings array. Raw: ${response.substring(0, 300)}`);
    }

    const map = new Map<string, string>();

    for (const m of parsed.mappings) {
      if (!m.raw || !m.normalized) {
        throw new Error(`IntentClassifierNode: mapping entry missing raw or normalized: ${JSON.stringify(m)}`);
      }
      map.set(String(m.raw), String(m.normalized));
    }

    // Si la IA no incluyó un intent → bypass, se queda con su nombre crudo
    for (const raw of rawIntents) {
      if (!map.has(raw)) {
        map.set(raw, raw);
      }
    }

    return map;
  }
}
