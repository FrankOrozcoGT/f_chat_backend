import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { KimiClient, ToolDefinition, ToolTermination } from '@common/external-integrations/kimi.client';
import { loadPrompt } from '@common/utils/load-prompt';

const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');
const SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'intent-splitter-system.md');

export interface SubFlowDescription {
  entrySubgraph: string;
  entryNodeName: string;
  reachableNodeNames: string[];
}

export interface AnalysisToClassify {
  analysisId: string;
  flowSummary: string | null;
  flowDiagram: string | null;
}

export interface IntentSplitterInput {
  originalIntent: string;
  subFlows: SubFlowDescription[];
  analyses: AnalysisToClassify[];
}

export interface IntentSplit {
  entrySubgraph: string;
  newIntentName: string;
}

export interface AnalysisAssignment {
  analysisId: string;
  entrySubgraph: string;
}

export interface IntentSplitterOutput {
  splits: IntentSplit[];
  assignments: AnalysisAssignment[];
  costUsd: number;
}

const SUBMIT_SPLITS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'submit_splits',
    description: 'Envía los nombres nuevos para cada sub-flujo y clasifica cada análisis.',
    parameters: {
      type: 'object',
      properties: {
        splits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entrySubgraph: { type: 'string' },
              newIntentName: { type: 'string' },
            },
            required: ['entrySubgraph', 'newIntentName'],
          },
        },
        assignments: {
          type: 'array',
          description: 'Cada análisis asignado al entrySubgraph al que corresponde',
          items: {
            type: 'object',
            properties: {
              analysisId: { type: 'string' },
              entrySubgraph: { type: 'string' },
            },
            required: ['analysisId', 'entrySubgraph'],
          },
        },
      },
      required: ['splits', 'assignments'],
    },
  },
};

@Injectable()
export class IntentSplitterNode {
  private readonly logger = new Logger(IntentSplitterNode.name);

  constructor(private readonly kimiClient: KimiClient) {}

  async split(input: IntentSplitterInput): Promise<IntentSplitterOutput> {
    const userPrompt = this.buildPrompt(input);
    let splitsArgs: Record<string, unknown> | null = null;

    const result = await this.kimiClient.chatWithTools({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [SUBMIT_SPLITS_TOOL],
      maxTokens: 1000,
      maxIterations: 3,
      onToolCall: async (name, args) => {
        if (name === 'submit_splits') {
          splitsArgs = args;
          throw new ToolTermination(name, args);
        }
        return JSON.stringify({ error: `Unknown tool: ${name}` });
      },
    });

    if (!splitsArgs) {
      throw new Error(`IntentSplitter [${input.originalIntent}]: no submit_splits call after ${result.iterations} iterations`);
    }
    const submittedArgs: Record<string, unknown> = splitsArgs;

    const rawSplits = submittedArgs.splits;
    if (!Array.isArray(rawSplits)) {
      throw new Error(`IntentSplitter [${input.originalIntent}]: "splits" no es un array — recibido: ${JSON.stringify(rawSplits)}`);
    }
    const splits = rawSplits.map((s: unknown, i: number) => {
      const entry = s as Record<string, unknown>;
      if (typeof entry.entrySubgraph !== 'string' || typeof entry.newIntentName !== 'string') {
        throw new Error(`IntentSplitter [${input.originalIntent}]: splits[${i}] inválido — recibido: ${JSON.stringify(entry)}`);
      }
      return {
        entrySubgraph: entry.entrySubgraph,
        newIntentName: entry.newIntentName.toLowerCase().replace(/\s+/g, '_'),
      };
    });

    const expected = new Set(input.subFlows.map((sf) => sf.entrySubgraph));
    for (const s of splits) {
      if (!expected.has(s.entrySubgraph)) {
        throw new Error(`IntentSplitter: unknown entrySubgraph "${s.entrySubgraph}"`);
      }
    }
    if (splits.length !== input.subFlows.length) {
      throw new Error(`IntentSplitter: returned ${splits.length} splits but expected ${input.subFlows.length}`);
    }

    const names = new Set(splits.map((s) => s.newIntentName));
    if (names.size !== splits.length) {
      throw new Error(`IntentSplitter: duplicate newIntentName`);
    }

    const rawAssignments = submittedArgs.assignments ?? [];
    if (!Array.isArray(rawAssignments)) {
      throw new Error(`IntentSplitter [${input.originalIntent}]: "assignments" no es un array — recibido: ${JSON.stringify(rawAssignments)}`);
    }
    const assignments: AnalysisAssignment[] = rawAssignments.map((a: unknown, i: number) => {
      const entry = a as Record<string, unknown>;
      if (typeof entry.analysisId !== 'string' || typeof entry.entrySubgraph !== 'string') {
        throw new Error(`IntentSplitter [${input.originalIntent}]: assignments[${i}] inválido — recibido: ${JSON.stringify(entry)}`);
      }
      return {
        analysisId: entry.analysisId,
        entrySubgraph: entry.entrySubgraph,
      };
    });

    const expectedAnalyses = new Set(input.analyses.map((a) => a.analysisId));
    const assignedIds = new Set<string>();
    for (const a of assignments) {
      if (!expectedAnalyses.has(a.analysisId)) {
        throw new Error(`IntentSplitter: unknown analysisId "${a.analysisId}"`);
      }
      if (!expected.has(a.entrySubgraph)) {
        throw new Error(`IntentSplitter: assignment to unknown entrySubgraph "${a.entrySubgraph}"`);
      }
      if (assignedIds.has(a.analysisId)) {
        throw new Error(`IntentSplitter: duplicate assignment for analysisId "${a.analysisId}"`);
      }
      assignedIds.add(a.analysisId);
    }
    if (assignedIds.size !== input.analyses.length) {
      const missing = input.analyses.filter((a) => !assignedIds.has(a.analysisId)).map((a) => a.analysisId);
      throw new Error(`IntentSplitter: ${missing.length} analyses not assigned: ${missing.join(', ')}`);
    }

    this.logger.log(
      `IntentSplitter [${input.originalIntent}]: ${splits.map((s) => `${s.entrySubgraph}→"${s.newIntentName}"`).join(', ')}, ${assignments.length} analyses assigned, $${result.costUsd.toFixed(6)}`,
    );

    return { splits, assignments, costUsd: result.costUsd };
  }

  private buildPrompt(input: IntentSplitterInput): string {
    const parts: string[] = [];
    parts.push(`## Intent original: "${input.originalIntent}"`);
    parts.push(`\nSe detectaron ${input.subFlows.length} puntos de entrada. Tu tarea tiene dos partes:\n`);
    parts.push(`### 1. Asignar nombre a cada sub-flujo:\n`);
    for (const sf of input.subFlows) {
      parts.push(`- entrySubgraph: \`${sf.entrySubgraph}\` (entrada: "${sf.entryNodeName}")`);
      parts.push(`  Nodos alcanzables: ${sf.reachableNodeNames.join(', ')}\n`);
    }
    parts.push(`\n### 2. Clasificar cada análisis a su sub-flujo correspondiente:\n`);
    for (const a of input.analyses) {
      parts.push(`- analysisId: \`${a.analysisId}\``);
      if (a.flowSummary) parts.push(`  Resumen: ${a.flowSummary}`);
      if (a.flowDiagram) parts.push(`  Diagrama: ${a.flowDiagram}`);
      parts.push('');
    }
    parts.push(`\nLlama a \`submit_splits\` con ambos: \`splits\` y \`assignments\` (uno por cada análisis).`);
    return parts.join('\n');
  }
}
