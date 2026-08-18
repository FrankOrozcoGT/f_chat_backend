import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { KimiClient, ToolDefinition, ToolTermination } from '@common/external-integrations/kimi.client';
import { loadPrompt } from '@common/utils/load-prompt';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { MessageRepository } from '@common/messaging/repositories/message.repository';

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

export interface InternalChannel {
  channelName: string | null;
  internalPurpose: string | null;
  clientId: string | null;
  groupJid: string | null;
}

export interface InternalQueueEntry {
  channelName: string;
  nodeId: string;
  queueType: 'fifo' | 'batch_reply' | 'llm_flexible';
  usage: string;
}

export interface RepresentativeCase {
  conversationId: string;
  path: string[];
  reason: string;
}

export interface DiagramConsolidatorInput {
  intentName: string;
  intentDescription?: string | null;
  conversationFlows: ConversationFlow[];
  internals: InternalChannel[];
  currentDiagram?: string | null;
  currentNodeMapping?: Record<string, NodeMappingEntry[]> | null;
  currentRepresentativeCases?: RepresentativeCase[] | null;
}

export interface DiagramConsolidatorOutput {
  diagram: string;
  nodeCategories: Record<string, string>;
  nodeMapping: Record<string, NodeMappingEntry[]>;
  representativeCases: RepresentativeCase[];
  internalQueues: InternalQueueEntry[];
  costUsd: number;
}

const CONSULT_INTERNAL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'consult_internal',
    description: 'Consulta los últimos mensajes de un canal interno para entender el patrón de interacción.',
    parameters: {
      type: 'object',
      properties: {
        channelName: {
          type: 'string',
          description: 'El channelName del canal interno a consultar',
        },
      },
      required: ['channelName'],
    },
  },
};

const SUBMIT_DIAGRAM_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'submit_diagram',
    description: 'Envía el diagrama consolidado final con nodeMapping e internalQueues.',
    parameters: {
      type: 'object',
      properties: {
        diagram: { type: 'string', description: 'Diagrama Mermaid flowchart TD' },
        nodeCategories: {
          type: 'object',
          description: 'Categoría de cada nodo: { nodeId: categoryName }',
          additionalProperties: { type: 'string' },
        },
        nodeMapping: {
          type: 'object',
          description: 'Mapeo de nodos consolidados a nodos individuales',
          additionalProperties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                conversationId: { type: 'string' },
                nodeId: { type: 'string' },
              },
              required: ['conversationId', 'nodeId'],
            },
          },
        },
        representativeCases: {
          type: 'array',
          description: 'Hasta 7 conversaciones representativas que cubren los distintos caminos del diagrama',
          items: {
            type: 'object',
            properties: {
              conversationId: { type: 'string' },
              path: { type: 'array', items: { type: 'string' }, description: 'IDs de nodos del diagrama que recorre esta conversación' },
              reason: { type: 'string', description: 'Por qué es representativa' },
            },
            required: ['conversationId', 'path', 'reason'],
          },
        },
        internalQueues: {
          type: 'array',
          description: 'Internals que participan en este flujo con su tipo de cola',
          items: {
            type: 'object',
            properties: {
              channelName: { type: 'string' },
              nodeId: { type: 'string', description: 'ID del nodo del diagrama donde se usa este internal' },
              queueType: { type: 'string', enum: ['fifo', 'batch_reply', 'llm_flexible'] },
              usage: { type: 'string', description: 'Descripción breve de cómo se usa el internal en ese nodo' },
            },
            required: ['channelName', 'nodeId', 'queueType', 'usage'],
          },
        },
      },
      required: ['diagram', 'nodeCategories', 'nodeMapping', 'representativeCases', 'internalQueues'],
    },
  },
};

@Injectable()
export class DiagramConsolidatorNode {
  private readonly logger = new Logger(DiagramConsolidatorNode.name);

  constructor(
    private readonly kimiClient: KimiClient,
    private readonly conversationRepo: ConversationRepository,
    private readonly messageRepo: MessageRepository,
  ) {}

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
      if (input.currentRepresentativeCases && input.currentRepresentativeCases.length > 0) {
        currentSection += `\n\nCasos representativos actuales:\n${JSON.stringify(input.currentRepresentativeCases)}`;
      }
    }

    let internalsSection = '';
    const validInternals = input.internals.filter((i) => i.channelName && i.internalPurpose);
    if (validInternals.length > 0) {
      internalsSection = '\n\n## Canales internos del negocio:\n' +
        validInternals.map((i) => `- **${i.channelName}**: ${i.internalPurpose}`).join('\n');
    }

    const intentHeader = input.intentDescription
      ? `Intención: **${input.intentName}** — ${input.intentDescription}`
      : `Intención: **${input.intentName}**`;

    const userPrompt = `${intentHeader}${currentSection}${internalsSection}\n\n## Flujos individuales a consolidar:\n\n${flowsText}`;

    // Build internals lookup for tool calls
    const internalsMap = new Map<string, InternalChannel>();
    for (const internal of input.internals) {
      if (internal.channelName) {
        internalsMap.set(internal.channelName, internal);
      }
    }

    const result = await this.kimiClient.chatWithTools({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [CONSULT_INTERNAL_TOOL, SUBMIT_DIAGRAM_TOOL],
      maxTokens: 8000,
      maxIterations: 15,
      onToolCall: async (name, args) => {
        if (name === 'submit_diagram') {
          throw new ToolTermination(name, args);
        }

        if (name === 'consult_internal') {
          return this.handleConsultInternal(args.channelName as string, internalsMap);
        }

        return JSON.stringify({ error: `Unknown tool: ${name}` });
      },
    });

    if (result.terminationTool === 'submit_diagram' && result.terminationArgs) {
      const args = result.terminationArgs as {
        diagram: string;
        nodeCategories: Record<string, string>;
        nodeMapping: Record<string, NodeMappingEntry[]>;
        representativeCases: RepresentativeCase[];
        internalQueues: InternalQueueEntry[];
      };

      if (!args.diagram || typeof args.diagram !== 'string') {
        throw new Error('DiagramConsolidator: submit_diagram missing diagram field');
      }
      if (!args.nodeMapping || typeof args.nodeMapping !== 'object') {
        throw new Error('DiagramConsolidator: submit_diagram missing nodeMapping field');
      }
      if (!args.nodeCategories || typeof args.nodeCategories !== 'object') {
        throw new Error('DiagramConsolidator: submit_diagram missing nodeCategories field');
      }
      if (!Array.isArray(args.internalQueues)) {
        throw new Error('DiagramConsolidator: submit_diagram missing internalQueues field');
      }

      this.logger.log(
        `DiagramConsolidator [${input.intentName}]: ${input.conversationFlows.length} flows consolidated, ` +
        `${args.internalQueues.length} internal queues, ` +
        `${result.iterations} iterations, cost=$${result.costUsd.toFixed(6)}`,
      );
      this.logger.log(`DiagramConsolidator [${input.intentName}] FULL DIAGRAM:\n${args.diagram}`);
      this.logger.log(`DiagramConsolidator [${input.intentName}] nodeCategories: ${JSON.stringify(args.nodeCategories)}`);

      return {
        diagram: args.diagram,
        nodeCategories: args.nodeCategories,
        nodeMapping: args.nodeMapping,
        representativeCases: args.representativeCases,
        internalQueues: args.internalQueues,
        costUsd: result.costUsd,
      };
    }

    throw new Error(
      `DiagramConsolidator [${input.intentName}]: IA no llamó submit_diagram en ${result.iterations} iteraciones`,
    );
  }

  private async handleConsultInternal(
    channelName: string,
    internalsMap: Map<string, InternalChannel>,
  ): Promise<string> {
    const internal = internalsMap.get(channelName);
    if (!internal) {
      return JSON.stringify({ error: `Canal interno "${channelName}" no encontrado` });
    }

    if (internal.groupJid) {
      // Group: last 75 messages
      const conversation = await this.conversationRepo.findIdByGroupJid(internal.groupJid);
      if (!conversation) {
        this.logger.error(`consult_internal: no conversation found for groupJid=${internal.groupJid} (${channelName})`);
        return JSON.stringify({ error: `Sin conversación encontrada para grupo "${channelName}"` });
      }

      const messages = await this.messageRepo.findRecentByConversationId(conversation.id, 75);

      if (messages.length === 0) {
        this.logger.error(`consult_internal: no messages found for group "${channelName}" (conversationId=${conversation.id})`);
        return JSON.stringify({ error: `Sin mensajes disponibles para grupo "${channelName}"` });
      }

      return this.formatMessages(messages.reverse(), channelName, 'grupo');
    }

    if (internal.clientId) {
      // Individual: last 50 messages
      const conversations = await this.conversationRepo.findIdsByIndividualClientId(internal.clientId);

      if (conversations.length === 0) {
        this.logger.error(`consult_internal: no individual conversation found for clientId=${internal.clientId} (${channelName})`);
        return JSON.stringify({ error: `Sin conversación encontrada para "${channelName}"` });
      }

      const conversationIds = conversations.map((c) => c.id);
      const messages = await this.messageRepo.findRecentByConversationIds(conversationIds, 50);

      if (messages.length === 0) {
        this.logger.error(`consult_internal: no messages found for "${channelName}" (clientId=${internal.clientId})`);
        return JSON.stringify({ error: `Sin mensajes disponibles para "${channelName}"` });
      }

      return this.formatMessages(messages.reverse(), channelName, 'individual');
    }

    this.logger.error(`consult_internal: internal "${channelName}" has no clientId or groupJid`);
    return JSON.stringify({ error: `Canal interno "${channelName}" sin clientId ni groupJid` });
  }

  private formatMessages(
    messages: { content: string; direction: string; senderType: string; createdAt: Date; metadata?: unknown }[],
    channelName: string,
    type: string,
  ): string {
    const formatted = messages.map((m) => {
      const sender = m.direction === 'outgoing' ? 'Negocio' : channelName;
      const metadata = m.metadata as Record<string, unknown> | null | undefined;
      const senderJid = typeof metadata?.senderJid === 'string' ? ` (${metadata.senderJid})` : '';
      return `[${sender}${senderJid}]: ${m.content}`;
    }).join('\n');

    return `Últimos ${messages.length} mensajes de "${channelName}" (${type}):\n\n${formatted}`;
  }

}
