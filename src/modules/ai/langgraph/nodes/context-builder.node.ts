import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClientMemoryRepository } from '../../repositories/client-memory.repository';
import { NodeMessageService } from '../../services/node-message.service';
import { WorkflowStateType, FlowData } from '../state.interface';

@Injectable()
export class ContextBuilderNode {
  private readonly logger = new Logger(ContextBuilderNode.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientMemoryRepository: ClientMemoryRepository,
    private readonly nodeMessageService: NodeMessageService,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    // Si un node anterior falló, skip
    if (state.error) return {};

    const { transcription, conversationId, flowData, clientPhone } = state;

    // If no flow data or no nodes, pass transcription raw
    if (!flowData || flowData.nodes.length === 0) {
      return { contextForLlm: null };
    }

    const parts: string[] = [];

    // 1. Client memories (mediano plazo)
    const client = await this.prisma.client.findUnique({
      where: { phoneNumber: clientPhone },
    });

    if (client) {
      const memories = await this.clientMemoryRepository.findByClientId(client.id);
      if (memories.length > 0) {
        parts.push('## Contexto del cliente');
        for (const mem of memories) {
          parts.push(`- ${mem.key}: ${JSON.stringify(mem.value)}`);
        }
        parts.push('');
      }
    }

    // 2. Current conversation flow
    parts.push('## Conversación actual');

    // Active nodes (foco + en mente)
    const activeNodes = flowData.nodes.filter(
      (n) => n.status === 'active' || n.status === 'reopened',
    );
    const collapsedNodes = flowData.nodes.filter((n) => n.status === 'collapsed');

    // Foco: current node with full messages
    if (flowData.currentNodeId) {
      const focusNode = activeNodes.find((n) => n.nodeId === flowData.currentNodeId);
      if (focusNode) {
        parts.push(`### Foco: ${focusNode.nodeId}`);
        parts.push(focusNode.understanding);

        // Load all messages for the focus node
        if (focusNode.messageIds?.length) {
          const msgs = await this.nodeMessageService.loadNodeMessages(
            focusNode.messageIds,
            conversationId,
            this.prisma,
          );
          if (msgs.length > 0) {
            parts.push('');
            for (const msg of msgs) {
              parts.push(`${msg.role === 'user' ? 'Cliente' : 'Bot'}: ${msg.content}`);
            }
          }
        }
        parts.push('');
      }
    }

    // En mente: other active nodes with their messages
    const otherActive = activeNodes.filter((n) => n.nodeId !== flowData.currentNodeId);
    if (otherActive.length > 0) {
      parts.push('### En mente:');
      for (const node of otherActive) {
        parts.push(`- ${node.nodeId}: ${node.understanding}`);
        if (node.messageIds?.length) {
          const msgs = await this.nodeMessageService.loadNodeMessages(
            node.messageIds,
            conversationId,
            this.prisma,
          );
          for (const msg of msgs) {
            parts.push(`  ${msg.role === 'user' ? 'Cliente' : 'Bot'}: ${msg.content}`);
          }
        }
      }
      parts.push('');
    }

    // Collapsed: one line each, NO messages (only labels)
    const visibleCollapsed = this.getVisibleCollapsed(collapsedNodes, flowData.nodes);
    if (visibleCollapsed.length > 0) {
      parts.push('### Resuelto:');
      for (const node of visibleCollapsed) {
        parts.push(`- ${node.nodeId}: ${node.understanding}`);
      }
      parts.push('');
    }

    // Current message
    parts.push(`### Mensaje actual:\n"${transcription}"`);

    const contextForLlm = parts.join('\n');
    this.logger.log(`ContextBuilder: built ${contextForLlm.length} chars context`);

    return { contextForLlm };
  }

  /**
   * Get collapsed nodes that are visible (their parent is NOT collapsed)
   */
  private getVisibleCollapsed(
    collapsedNodes: { nodeId: string; parentId: string | null; understanding: string }[],
    allNodes: { nodeId: string; status: string }[],
  ) {
    return collapsedNodes.filter((node) => {
      if (!node.parentId) return true;
      const parent = allNodes.find((n) => n.nodeId === node.parentId);
      return !parent || parent.status !== 'collapsed';
    });
  }
}
