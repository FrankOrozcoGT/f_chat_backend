import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { KimiClient, ToolDefinition, ToolTermination } from '@common/external-integrations/kimi.client';
import { TodoDefinition } from '@modules/nodes/functions/implementations/update-todos.fn';
import { loadPrompt } from '@common/utils/load-prompt';

const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');

const AVAILABLE_TOOLS: { name: string; description: string }[] = [
  { name: 'getMemories', description: 'Recupera valores almacenados en la memoria del tenant' },
  { name: 'loadClientProducts', description: 'Carga productos que el cliente ha comprado antes' },
  { name: 'searchProduct', description: 'Busca producto en el catálogo' },
  { name: 'calculateSale', description: 'Calcula total de venta con productos, cantidades y ubicación' },
  { name: 'checkPromotions', description: 'Verifica promociones aplicables a un producto' },
  { name: 'saveProductPrice', description: 'Guarda o actualiza precio de un producto' },
  { name: 'registerMissingProduct', description: 'Registra producto que busca el cliente pero no existe' },
  { name: 'saveClientLocation', description: 'Guarda ubicación del cliente para envío' },
  { name: 'sendToInternalChannel', description: 'Envía un mensaje a un canal interno del negocio (usa channelName). Pausa hasta recibir respuesta.' },
  { name: 'moveToNegotiation', description: 'Registra que el cliente quiere negociar precio' },
  { name: 'salesRejection', description: 'Registra rechazo de venta con motivo' },
  { name: 'updateTodos', description: 'Marca o desmarca todos del nodo actual' },
  { name: 'transitionToNode', description: 'Transiciona a otro nodo del flow' },
  { name: 'exitFlow', description: 'Sale del flujo actual' },
  { name: 'switchToHitl', description: 'Transfiere la conversación a humano' },
  { name: 'closeSession', description: 'Cierra la conversación (cliente se despide)' },
];

const AVAILABLE_TOOL_NAMES = AVAILABLE_TOOLS.map((t) => t.name);

const SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'node-content-generator-system.md').replace(
  '{{AVAILABLE_TOOLS}}',
  AVAILABLE_TOOLS.map((t) => `- **${t.name}**: ${t.description}`).join('\n'),
);

export interface NodeContentGeneratorInput {
  intentName: string;
  nodeName: string;
  steps: { id: string; label: string }[];
  isTerminal: boolean;
}

export interface ProposedTool {
  name: string;
  description: string;
}

export interface NodeContent {
  name: string;
  systemPrompt: string;
  todos: TodoDefinition[];
  tools: string[];
  isClosureNode: boolean;
}

export interface NodeContentGeneratorOutput {
  node: NodeContent;
  proposedTools: ProposedTool[];
  costUsd: number;
}

const PROPOSE_TOOL_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'propose_tool',
    description: 'Propone una herramienta nueva que no existe en el listado disponible.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name', 'description'],
    },
  },
};

const SUBMIT_NODE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'submit_node',
    description: 'Finaliza la generación del nodo con su contenido completo.',
    parameters: {
      type: 'object',
      properties: {
        systemPrompt: { type: 'string', description: 'Instrucciones completas del agente IA en este nodo' },
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              functions: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'name', 'description', 'functions'],
          },
        },
        tools: { type: 'array', items: { type: 'string' } },
        isClosureNode: { type: 'boolean', description: 'Solo relevante si isTerminal=true: true si el nodo cierra/se despide, false si es terminal pero hace una acción y sale' },
      },
      required: ['systemPrompt', 'todos', 'tools', 'isClosureNode'],
    },
  },
};

@Injectable()
export class NodeContentGeneratorNode {
  private readonly logger = new Logger(NodeContentGeneratorNode.name);

  constructor(private readonly kimiClient: KimiClient) {}

  async generate(input: NodeContentGeneratorInput): Promise<NodeContentGeneratorOutput> {
    const userPrompt = this.buildUserPrompt(input);
    const proposedTools: ProposedTool[] = [];
    let nodeArgs: Record<string, unknown> | null = null;

    const result = await this.kimiClient.chatWithTools({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [PROPOSE_TOOL_DEF, SUBMIT_NODE_TOOL],
      maxTokens: 3000,
      maxIterations: 5,
      onToolCall: async (name, args) => {
        if (name === 'submit_node') {
          nodeArgs = args;
          throw new ToolTermination(name, args);
        }
        if (name === 'propose_tool') {
          const tool: ProposedTool = { name: args.name as string, description: args.description as string };
          proposedTools.push(tool);
          return JSON.stringify({ ok: true, name: tool.name });
        }
        return JSON.stringify({ error: `Unknown tool: ${name}` });
      },
    });

    if (!nodeArgs) {
      throw new Error(`NodeContentGenerator [${input.intentName}/${input.nodeName}]: no submit_node call after ${result.iterations} iterations`);
    }

    const node = this.validateNode(input.nodeName, nodeArgs);

    this.logger.log(
      `NodeContentGenerator [${input.intentName}/${input.nodeName}]: ${node.todos.length} todos, ${node.tools.length} tools, closure=${node.isClosureNode}, $${result.costUsd.toFixed(6)}`,
    );

    return { node, proposedTools, costUsd: result.costUsd };
  }

  private buildUserPrompt(input: NodeContentGeneratorInput): string {
    const parts: string[] = [];
    parts.push(`## Intent: "${input.intentName}"`);
    parts.push(`## Nombre del nodo a generar: "${input.nodeName}"`);

    parts.push(`\n## Pasos internos (sub-acciones del nodo):`);
    for (const step of input.steps) {
      parts.push(`- ${step.id}: ${step.label}`);
    }

    if (input.isTerminal) {
      parts.push(`\nEste nodo es terminal (último del flow). Evalúa si es despedida/cierre semántico y marca \`isClosureNode\` apropiadamente.`);
    }

    parts.push(`\nGenera SOLO systemPrompt + todos internos + tools. No incluyas transiciones ni internals — el orquestador los añade automáticamente.`);
    parts.push(`\nLlama a \`submit_node\` con el resultado.`);
    return parts.join('\n');
  }

  private validateNode(name: string, args: Record<string, unknown>): NodeContent {
    const systemPrompt = args.systemPrompt as string;
    if (!systemPrompt) throw new Error(`NodeContentGenerator: node "${name}" missing systemPrompt`);

    const rawTodos = args.todos as Record<string, unknown>[];
    if (!Array.isArray(rawTodos) || rawTodos.length === 0) {
      throw new Error(`NodeContentGenerator: node "${name}" missing todos`);
    }

    const todos: TodoDefinition[] = rawTodos.map((t, j) => {
      if (!t.id || !t.name || !t.description) {
        throw new Error(`NodeContentGenerator: node "${name}" todos[${j}] missing id/name/description`);
      }
      return {
        id: t.id as string,
        name: t.name as string,
        description: t.description as string,
        functions: ((t.functions as string[]) ?? []).filter((f: string) => AVAILABLE_TOOL_NAMES.includes(f)),
      };
    });

    const tools: string[] = (args.tools as string[] ?? []).filter((t) => AVAILABLE_TOOL_NAMES.includes(t));
    const isClosureNode = args.isClosureNode === true;

    return { name, systemPrompt, todos, tools, isClosureNode };
  }
}
