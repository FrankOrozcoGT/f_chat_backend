import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { KimiClient, ToolDefinition, ToolTermination } from '@modules/ai/clients/kimi.client';
import { TodoDefinition } from '@modules/nodes/functions/implementations/update-todos.fn';
import { loadPrompt } from '@common/utils/load-prompt';

const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');

const AVAILABLE_TOOLS: { name: string; description: string }[] = [
  { name: 'getMemories', description: 'Recupera valores almacenados en la memoria del tenant (info bancaria, horarios, métodos de pago, etc.)' },
  { name: 'loadClientProducts', description: 'Carga los productos que el cliente ha comprado anteriormente' },
  { name: 'searchProduct', description: 'Busca un producto en el catálogo por nombre o descripción' },
  { name: 'calculateSale', description: 'Calcula el total de una venta con productos, cantidades y ubicación del cliente' },
  { name: 'checkPromotions', description: 'Verifica si hay promociones aplicables a un producto específico' },
  { name: 'saveProductPrice', description: 'Guarda o actualiza el precio de un producto en el catálogo' },
  { name: 'registerMissingProduct', description: 'Registra un producto que el cliente busca pero no existe en el catálogo' },
  { name: 'saveClientLocation', description: 'Guarda o actualiza la ubicación del cliente para calcular envío' },
  { name: 'forwardReceipt', description: 'Reenvía un comprobante de pago al grupo de verificación con datos del cliente y pedido' },
  { name: 'sendToVerification', description: 'Envía datos de pago al proceso de verificación (nombre, monto, resumen, messageId del comprobante)' },
  { name: 'moveToNegotiation', description: 'Registra que el cliente quiere negociar precio de un producto' },
  { name: 'salesRejection', description: 'Registra el rechazo de una venta con motivo y producto' },
  { name: 'updateTodos', description: 'Marca o desmarca todos del nodo actual. Retorna los pendientes y los alternos disponibles' },
  { name: 'transitionToNode', description: 'Transiciona a otro nodo del flow con un código de transición y resumen de progreso' },
  { name: 'exitFlow', description: 'Sale del flujo actual cuando el cliente cambió de tema o pidió algo fuera del flujo' },
  { name: 'switchToHitl', description: 'Transfiere la conversación a un agente humano cuando el cliente lo solicita' },
  { name: 'closeSession', description: 'Cierra la conversación cuando el cliente se despide y hay historial previo' },
];

const AVAILABLE_TOOL_NAMES = AVAILABLE_TOOLS.map((t) => t.name);

const SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'flow-generator-system.md').replace(
  '{{AVAILABLE_TOOLS}}',
  AVAILABLE_TOOLS.map((t) => `- **${t.name}**: ${t.description}`).join('\n'),
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

export interface ProposedTool {
  name: string;
  description: string;
}

export interface FlowGeneratorOutput {
  nodes: GeneratedNode[];
  transitions: GeneratedTransition[];
  proposedTools: ProposedTool[];
}

export interface FlowGeneratorInput {
  intentName: string;
  consolidatedDiagram: string | null;
  nodeCategories: Record<string, string> | null;
  internalQueues: { channelName: string; nodeId: string; queueType: string; usage: string }[] | null;
  existingFlows: { name: string; nodes: { node: { name: string; systemPrompt: string } }[] }[];
}

const CREATE_NODE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_node',
    description: 'Crea un nodo del flow con su nombre, systemPrompt, todos y tools.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre del nodo' },
        systemPrompt: { type: 'string', description: 'Instrucciones completas para el agente IA en este nodo' },
        todos: {
          type: 'array',
          description: 'Tareas concretas que el nodo debe completar',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'ID snake_case único dentro del nodo' },
              name: { type: 'string', description: 'Nombre corto legible' },
              description: { type: 'string', description: 'Instrucciones detalladas' },
              functions: { type: 'array', items: { type: 'string' }, description: 'Tools que usa este todo' },
              transitions: { type: 'array', items: { type: 'string' }, description: 'Códigos de transición si es punto de salida' },
            },
            required: ['id', 'name', 'description', 'functions'],
          },
        },
        tools: { type: 'array', items: { type: 'string' }, description: 'Herramientas disponibles para este nodo' },
      },
      required: ['name', 'systemPrompt', 'todos', 'tools'],
    },
  },
};

const CREATE_TRANSITION_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_transition',
    description: 'Crea una transición entre dos nodos.',
    parameters: {
      type: 'object',
      properties: {
        fromNodeIndex: { type: 'number', description: 'Índice del nodo origen (0 = primer nodo creado)' },
        toNodeIndex: { type: 'number', description: 'Índice del nodo destino' },
        transitionCode: { type: 'string', description: 'Código snake_case de la transición' },
      },
      required: ['fromNodeIndex', 'toNodeIndex', 'transitionCode'],
    },
  },
};

const PROPOSE_TOOL_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'propose_tool',
    description: 'Propone una herramienta nueva que no existe en el listado disponible.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre de la herramienta propuesta' },
        description: { type: 'string', description: 'Qué haría esta herramienta' },
      },
      required: ['name', 'description'],
    },
  },
};

const SUBMIT_FLOW_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'submit_flow',
    description: 'Finaliza la generación del flow. Llamar cuando todos los nodos y transiciones estén creados.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

@Injectable()
export class FlowGeneratorNode {
  private readonly logger = new Logger(FlowGeneratorNode.name);

  constructor(private readonly kimiClient: KimiClient) {}

  async generate(input: FlowGeneratorInput): Promise<FlowGeneratorOutput> {
    const userPrompt = this.buildUserPrompt(input);

    const nodes: GeneratedNode[] = [];
    const transitions: GeneratedTransition[] = [];
    const proposedTools: ProposedTool[] = [];

    const result = await this.kimiClient.chatWithTools({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [CREATE_NODE_TOOL, CREATE_TRANSITION_TOOL, PROPOSE_TOOL_DEF, SUBMIT_FLOW_TOOL],
      maxTokens: 4000,
      maxIterations: 30,
      onToolCall: async (name, args) => {
        if (name === 'submit_flow') {
          throw new ToolTermination(name, args);
        }

        if (name === 'create_node') {
          const node = this.validateNode(args, nodes.length);
          nodes.push(node);
          this.logger.log(`create_node [${input.intentName}]: "${node.name}" (index=${nodes.length - 1}, ${node.todos.length} todos)`);
          return JSON.stringify({ ok: true, nodeIndex: nodes.length - 1, name: node.name });
        }

        if (name === 'create_transition') {
          const transition = this.validateTransition(args, nodes.length);
          transitions.push(transition);
          this.logger.log(`create_transition [${input.intentName}]: ${transition.fromNodeIndex} → ${transition.toNodeIndex} (${transition.transitionCode})`);
          return JSON.stringify({ ok: true });
        }

        if (name === 'propose_tool') {
          const tool: ProposedTool = { name: args.name as string, description: args.description as string };
          proposedTools.push(tool);
          this.logger.log(`propose_tool [${input.intentName}]: "${tool.name}"`);
          return JSON.stringify({ ok: true, name: tool.name });
        }

        return JSON.stringify({ error: `Unknown tool: ${name}` });
      },
    });

    if (nodes.length === 0) {
      throw new Error(`FlowGeneratorNode [${input.intentName}]: no nodes created after ${result.iterations} iterations`);
    }

    this.logger.log(
      `FlowGeneratorNode [${input.intentName}]: ${nodes.length} nodos, ${transitions.length} transiciones, ${result.iterations} iterations, $${result.costUsd.toFixed(6)}`,
    );

    return { nodes, transitions, proposedTools };
  }

  private validateNode(args: Record<string, unknown>, currentIndex: number): GeneratedNode {
    const name = args.name as string;
    const systemPrompt = args.systemPrompt as string;
    if (!name || !systemPrompt) {
      throw new Error(`FlowGeneratorNode: node[${currentIndex}] missing name or systemPrompt`);
    }

    const rawTodos = args.todos as any[];
    if (!Array.isArray(rawTodos) || rawTodos.length === 0) {
      throw new Error(`FlowGeneratorNode: node[${currentIndex}] "${name}" missing todos`);
    }

    const todos: TodoDefinition[] = rawTodos.map((t, j) => {
      if (!t.id || !t.name || !t.description) {
        throw new Error(`FlowGeneratorNode: node[${currentIndex}].todos[${j}] missing id, name or description`);
      }
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        functions: (t.functions ?? []).filter((f: string) => AVAILABLE_TOOL_NAMES.includes(f)),
        transitions: t.transitions,
      };
    });

    const tools: string[] = (args.tools as string[] ?? []).filter((t) => AVAILABLE_TOOL_NAMES.includes(t));

    return { name, systemPrompt, todos, tools };
  }

  private validateTransition(args: Record<string, unknown>, nodeCount: number): GeneratedTransition {
    const fromNodeIndex = args.fromNodeIndex as number;
    const toNodeIndex = args.toNodeIndex as number;
    const transitionCode = args.transitionCode as string;

    if (fromNodeIndex === undefined || toNodeIndex === undefined || !transitionCode) {
      throw new Error(`FlowGeneratorNode: transition missing required fields`);
    }
    if (fromNodeIndex >= nodeCount || toNodeIndex >= nodeCount) {
      throw new Error(`FlowGeneratorNode: transition references out-of-bounds node index (from=${fromNodeIndex}, to=${toNodeIndex}, nodeCount=${nodeCount})`);
    }

    return { fromNodeIndex, toNodeIndex, transitionCode };
  }

  private buildUserPrompt(input: FlowGeneratorInput): string {
    const parts: string[] = [];

    parts.push(`## Intención a modelar: "${input.intentName}"`);

    if (input.consolidatedDiagram) {
      parts.push(`\n## Diagrama consolidado del intent:\n${input.consolidatedDiagram}`);
    }

    if (input.nodeCategories && Object.keys(input.nodeCategories).length > 0) {
      parts.push(`\n## Categorías de nodos del diagrama:`);
      for (const [nodeId, category] of Object.entries(input.nodeCategories)) {
        parts.push(`- ${nodeId}: ${category}`);
      }
    }

    if (input.internalQueues && input.internalQueues.length > 0) {
      parts.push(`\n## Comunicación con canales internos en este flujo:`);
      input.internalQueues.forEach((q) => {
        parts.push(`- **${q.channelName}** en nodo ${q.nodeId} (cola: ${q.queueType}): ${q.usage}`);
      });
    }

    if (input.existingFlows.length > 0) {
      parts.push(`\n## Flows activos existentes (NO repetir, solo tomar como referencia de estilo):`);
      input.existingFlows.forEach((f) => {
        const nodeNames = f.nodes.map((n) => n.node.name).join(', ');
        parts.push(`- "${f.name}": nodos [${nodeNames}]`);
      });
    }

    parts.push(`\nGenera el flow borrador para la intención "${input.intentName}".`);

    return parts.join('\n');
  }
}
