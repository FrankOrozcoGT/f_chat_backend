import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { KimiClient } from '@modules/ai/clients/kimi.client';
import { TodoDefinition } from '@modules/nodes/functions/implementations/update-todos.fn';
import { loadPrompt } from '@common/utils/load-prompt';

const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');

const AVAILABLE_TOOLS = [
  'getMemories',
  'loadClientProducts',
  'searchProduct',
  'calculateSale',
  'checkPromotions',
  'saveProductPrice',
  'registerMissingProduct',
  'saveClientLocation',
  'forwardReceipt',
  'sendToVerification',
  'moveToNegotiation',
  'salesRejection',
  'updateTodos',
  'transitionToNode',
  'exitFlow',
  'switchToHitl',
  'closeSession',
];

const SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'flow-generator-system.md').replace(
  '{{AVAILABLE_TOOLS}}',
  AVAILABLE_TOOLS.join(', '),
);

export interface GeneratedNode {
  name: string;
  systemPrompt: string;
  todos: TodoDefinition[];
  tools: string[];
}

export interface GeneratedTransition {
  fromNodeIndex: number;
  toNodeIndex: number;
  transitionCode: string;
}

export type RepresentativeCase = { flowSummary: string; flowDiagram: string };

export interface ProposedTool {
  name: string;
  description: string;
}

export interface FlowGeneratorOutput {
  nodes: GeneratedNode[];
  transitions: GeneratedTransition[];
  selectedCases: RepresentativeCase[];
  proposedTools: ProposedTool[];
}

export interface FlowGeneratorInput {
  intentName: string;
  conversationFlows: { flowSummary: string | null; flowDiagram: string | null }[];
  internalChannels: { label: string; internalPurpose: string | null }[];
  existingFlows: { name: string; nodes: { node: { name: string; systemPrompt: string } }[] }[];
  existingIntents: { name: string }[];
  currentCases?: RepresentativeCase[];
}

@Injectable()
export class FlowGeneratorNode {
  private readonly logger = new Logger(FlowGeneratorNode.name);

  constructor(private readonly kimiClient: KimiClient) {}

  async generate(input: FlowGeneratorInput): Promise<FlowGeneratorOutput> {
    const userPrompt = this.buildUserPrompt(input);

    const result = await this.kimiClient.rawChat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      4000,
    );

    const parsed = this.parseResponse(result.response);

    this.logger.log(
      `FlowGeneratorNode [${input.intentName}]: ${parsed.nodes.length} nodos, ${parsed.transitions.length} transiciones, $${result.costUsd.toFixed(6)}`,
    );

    return parsed;
  }

  private buildUserPrompt(input: FlowGeneratorInput): string {
    const parts: string[] = [];

    parts.push(`## Intención a modelar: "${input.intentName}"`);

    if (input.currentCases) {
      parts.push(`\n## Diseño actual del flow (generado con análisis anteriores — refínalo):`);
      parts.push(JSON.stringify(input.currentCases, null, 2));
      parts.push(`\n## Nuevos diagramas a incorporar (${input.conversationFlows.length}):`);
    } else {
      parts.push(`\n## Diagramas y resúmenes de flujos reales (${input.conversationFlows.length}):`);
    }

    input.conversationFlows.forEach((c, i) => {
      parts.push(`\n### Conversación ${i + 1}`);
      if (c.flowSummary) parts.push(`**Resumen:** ${c.flowSummary}`);
      if (c.flowDiagram) parts.push(`**Diagrama:**\n${c.flowDiagram}`);
    });

    if (input.internalChannels.length > 0) {
      parts.push(`\n## Canales internos relacionados:`);
      input.internalChannels.forEach((ch) => {
        parts.push(`- ${ch.label}: ${ch.internalPurpose ?? 'sin propósito definido'}`);
      });
    }

    if (input.existingFlows.length > 0) {
      parts.push(`\n## Flows activos existentes (NO repetir, solo tomar como referencia de estilo):`);
      input.existingFlows.forEach((f) => {
        const nodeNames = f.nodes.map((n) => n.node.name).join(', ');
        parts.push(`- "${f.name}": nodos [${nodeNames}]`);
      });
    }

    if (input.existingIntents.length > 0) {
      parts.push(`\n## Intenciones activas existentes: ${input.existingIntents.map((i) => i.name).join(', ')}`);
    }

    if (input.currentCases) {
      parts.push(`\nRefina el diseño del flow incorporando los nuevos diagramas. El flow resultante debe ser capaz de manejar todos los escenarios vistos hasta ahora.`);
    } else {
      parts.push(`\nGenera el flow borrador para la intención "${input.intentName}".`);
    }

    return parts.join('\n');
  }

  private parseResponse(response: string): FlowGeneratorOutput {
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      throw new Error(`FlowGeneratorNode: LLM returned invalid JSON: ${error.message}. Raw: ${response.substring(0, 300)}`);
    }

    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
      throw new Error('FlowGeneratorNode: response missing nodes array or empty');
    }
    if (!Array.isArray(parsed.transitions)) {
      throw new Error('FlowGeneratorNode: response missing transitions array');
    }

    const nodes: GeneratedNode[] = parsed.nodes.map((n: any, i: number) => {
      if (!n.name || !n.systemPrompt) {
        throw new Error(`FlowGeneratorNode: node[${i}] missing name or systemPrompt`);
      }
      if (!Array.isArray(n.todos) || n.todos.length === 0) {
        throw new Error(`FlowGeneratorNode: node[${i}] "${n.name}" missing todos — todos son obligatorios`);
      }
      const todos: TodoDefinition[] = n.todos.map((t: any, j: number) => {
        if (!t.id || !t.name || !t.description) {
          throw new Error(`FlowGeneratorNode: node[${i}].todos[${j}] missing id, name or description`);
        }
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          functions: (t.functions ?? []).filter((f: string) => AVAILABLE_TOOLS.includes(f)),
        };
      });
      const tools: string[] = (n.tools ?? []).filter((t: string) => AVAILABLE_TOOLS.includes(t));
      return { name: n.name, systemPrompt: n.systemPrompt, todos, tools };
    });

    const transitions: GeneratedTransition[] = parsed.transitions.map((t: any, i: number) => {
      if (t.fromNodeIndex === undefined || t.toNodeIndex === undefined || !t.transitionCode) {
        throw new Error(`FlowGeneratorNode: transition[${i}] missing required fields`);
      }
      if (t.fromNodeIndex >= nodes.length || t.toNodeIndex >= nodes.length) {
        throw new Error(`FlowGeneratorNode: transition[${i}] references out-of-bounds node index`);
      }
      return {
        fromNodeIndex: t.fromNodeIndex,
        toNodeIndex: t.toNodeIndex,
        transitionCode: t.transitionCode,
      };
    });

    if (!Array.isArray(parsed.selectedCases)) {
      throw new Error('FlowGeneratorNode: response missing selectedCases array');
    }

    const selectedCases: RepresentativeCase[] = parsed.selectedCases.map((c: any, i: number) => {
      if (!c.flowSummary || !c.flowDiagram) {
        throw new Error(`FlowGeneratorNode: selectedCases[${i}] missing flowSummary or flowDiagram`);
      }
      return { flowSummary: c.flowSummary, flowDiagram: c.flowDiagram };
    });

    const proposedTools: ProposedTool[] = Array.isArray(parsed.proposedTools)
      ? parsed.proposedTools.filter((t: any) => t.name && t.description).map((t: any) => ({ name: t.name, description: t.description }))
      : [];

    return { nodes, transitions, selectedCases, proposedTools };
  }
}
