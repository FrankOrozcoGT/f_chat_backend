import { Injectable, Logger } from '@nestjs/common';
import { KimiClient } from '@modules/ai/clients/kimi.client';
import { TodoDefinition } from '@modules/nodes/functions/implementations/update-todos.fn';

export interface FlowGeneratorInput {
  intentName: string;
  conversationFlows: { flowSummary: string | null; flowDiagram: string | null }[];
  internalChannels: { label: string; internalPurpose: string | null }[];
  existingFlows: { name: string; nodes: { node: { name: string; systemPrompt: string } }[] }[];
  existingIntents: { name: string }[];
}

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

export interface FlowGeneratorOutput {
  nodes: GeneratedNode[];
  transitions: GeneratedTransition[];
}

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

const SYSTEM_PROMPT = `Eres un experto en diseño de flujos conversacionales para chatbots de WhatsApp.
Tu tarea es analizar conversaciones reales de una intención específica y generar un flow borrador con nodos y transiciones.

CONCEPTOS CLAVE:
- Cada nodo representa un estado/etapa de la conversación
- El primer nodo (índice 0) es el nodo inicial (punto de entrada al flow)
- systemPrompt: instrucciones del agente IA para ese nodo — qué hace, cómo responde, cuándo transicionar
- tools: herramientas disponibles para ese nodo (del listado de HERRAMIENTAS DISPONIBLES)
- todos: LA PARTE MÁS IMPORTANTE — son las tareas concretas que el nodo DEBE completar, en orden.
  Cada todo describe exactamente qué debe hacer el agente, qué tools usar y en qué condiciones.
  Sin todos bien definidos el nodo no sabe qué hacer.

ESTRUCTURA DE UN TODO:
{
  "id": "snake_case único dentro del nodo",
  "name": "nombre corto legible",
  "description": "instrucciones detalladas: qué hacer paso a paso, cuándo usar cada tool, casos especiales, condiciones de salida",
  "functions": ["toolsQueUsaEsteTodo"]
}

REGLAS:
- Cada nodo debe tener al menos 2-4 todos que cubran su flujo completo
- Los todos deben estar ordenados secuencialmente (el agente los ejecuta en orden)
- En description explica los casos borde: qué hacer si el cliente no confirma, si el producto no existe, si quiere cambiar algo
- tools del nodo = unión de todas las functions de sus todos
- transitions: condiciones de salida del nodo con transitionCode en snake_case
- NO uses herramientas que no estén en el listado disponible

HERRAMIENTAS DISPONIBLES:
${AVAILABLE_TOOLS.join(', ')}

Responde SOLO con JSON válido en este formato:
{
  "nodes": [
    {
      "name": "nombre del nodo",
      "systemPrompt": "instrucciones completas para el agente IA en este nodo",
      "todos": [
        {
          "id": "primer_paso",
          "name": "Nombre corto del paso",
          "description": "Descripción detallada de qué hacer, cómo, cuándo, casos borde",
          "functions": ["toolCode1"]
        },
        {
          "id": "segundo_paso",
          "name": "Nombre corto del paso",
          "description": "Descripción detallada",
          "functions": ["toolCode2", "toolCode3"]
        }
      ],
      "tools": ["toolCode1", "toolCode2", "toolCode3"]
    }
  ],
  "transitions": [
    {
      "fromNodeIndex": 0,
      "toNodeIndex": 1,
      "transitionCode": "codigo_transicion_snake_case"
    }
  ]
}`;

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

    parts.push(`\n## Conversaciones reales de esta intención (${input.conversationFlows.length}):`);
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

    parts.push(`\nGenera el flow borrador para la intención "${input.intentName}".`);

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
      return {
        name: n.name,
        systemPrompt: n.systemPrompt,
        todos,
        tools,
      };
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

    return { nodes, transitions };
  }
}
