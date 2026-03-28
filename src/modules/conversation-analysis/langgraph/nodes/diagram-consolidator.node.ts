import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { KimiClient } from '@modules/ai/clients/kimi.client';
import { loadPrompt } from '@common/utils/load-prompt';

const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');
const SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'diagram-consolidator-system.md');

export interface ConversationFlow {
  conversationId: string;
  flowSummary: string | null;
  flowDiagram: string | null;
}

export interface NodeMappingEntry {
  conversationId: string;
  nodeId: string;
}

export interface DiagramConsolidatorInput {
  intentName: string;
  conversationFlows: ConversationFlow[];
  currentDiagram?: string | null;
  currentNodeMapping?: Record<string, NodeMappingEntry[]> | null;
}

export interface DiagramConsolidatorOutput {
  diagram: string;
  nodeMapping: Record<string, NodeMappingEntry[]>;
  costUsd: number;
}

@Injectable()
export class DiagramConsolidatorNode {
  private readonly logger = new Logger(DiagramConsolidatorNode.name);

  constructor(private readonly kimiClient: KimiClient) {}

  async consolidate(input: DiagramConsolidatorInput): Promise<DiagramConsolidatorOutput> {
    const flowsText = input.conversationFlows
      .filter((f) => f.flowSummary || f.flowDiagram)
      .map((f) => {
        const parts: string[] = [`### Conversación ${f.conversationId}`];
        if (f.flowSummary) parts.push(`Resumen: ${f.flowSummary}`);
        if (f.flowDiagram) parts.push(`Diagrama:\n${f.flowDiagram}`);
        return parts.join('\n');
      })
      .join('\n\n');

    let currentSection = '';
    if (input.currentDiagram) {
      currentSection = `\n\n## Diagrama base actual (refinar):\n${input.currentDiagram}`;
      if (input.currentNodeMapping) {
        currentSection += `\n\nNodeMapping actual:\n${JSON.stringify(input.currentNodeMapping)}`;
      }
    }

    const userPrompt = `Intención: **${input.intentName}**${currentSection}\n\n## Flujos individuales a consolidar:\n\n${flowsText}`;

    const result = await this.kimiClient.rawChat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      8000,
    );

    const parsed = this.parseResponse(result.response);

    this.logger.log(
      `DiagramConsolidator [${input.intentName}]: ${input.conversationFlows.length} flows consolidated, cost=$${result.costUsd.toFixed(6)}`,
    );

    return { diagram: parsed.diagram, nodeMapping: parsed.nodeMapping, costUsd: result.costUsd };
  }

  private parseResponse(response: string): { diagram: string; nodeMapping: Record<string, NodeMappingEntry[]> } {
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    if (!parsed.diagram || typeof parsed.diagram !== 'string') {
      throw new Error('DiagramConsolidator: LLM response missing diagram field');
    }
    if (!parsed.nodeMapping || typeof parsed.nodeMapping !== 'object') {
      throw new Error('DiagramConsolidator: LLM response missing nodeMapping field');
    }
    return { diagram: parsed.diagram, nodeMapping: parsed.nodeMapping };
  }
}
