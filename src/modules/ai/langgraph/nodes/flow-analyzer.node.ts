import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { KimiClient } from '../../clients/kimi.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { FlowCacheService } from '../../services/flow-cache.service';
import { NodeMessageService } from '../../services/node-message.service';
import { SessionRepository } from '../../repositories/session.repository';
import { ClientMemoryRepository } from '../../repositories/client-memory.repository';
import { WorkflowStateType, FlowData, FlowOperation, FlowOpType, FlowNode } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { ApiType } from '@prisma/client';
import { loadPrompt } from '../../prompts/load-prompt';

const ANALYZER_SYSTEM_PROMPT = loadPrompt('analyzer-system.md');

const VALID_OPS: FlowOpType[] = ['create', 'close', 'reopen', 'focus', 'end'];

@Injectable()
export class FlowAnalyzerNode {
  private readonly logger = new Logger(FlowAnalyzerNode.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kimiClient: KimiClient,
    private readonly langSmithService: LangSmithService,
    private readonly flowCacheService: FlowCacheService,
    private readonly nodeMessageService: NodeMessageService,
    private readonly sessionRepository: SessionRepository,
    private readonly clientMemoryRepository: ClientMemoryRepository,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    // Si un node anterior falló, skip
    if (state.error) return {};

    const {
      transcription,
      conversationId,
      messageId,
      apiCalls: existingApiCalls,
      totalCost: existingCost,
    } = state;

    // 1. Get or create session
    const session = await this.sessionRepository.findOrCreate(conversationId);
    const sessionId = session.id;

    // 2. Load flow data from Redis (or DB on cache miss)
    const flowData = await this.flowCacheService.load(conversationId, sessionId);

    // 3. Build context for analyzer
    const activeNodes = flowData.nodes.filter((n) => n.status === 'active' || n.status === 'reopened');
    const collapsedNodes = flowData.nodes.filter((n) => n.status === 'collapsed');

    let nodesList = '';
    if (activeNodes.length > 0) {
      nodesList += 'Nodos activos:\n' +
        activeNodes.map((n) => `- ${n.nodeId}${n.nodeId === flowData.currentNodeId ? ' (foco)' : ''}`).join('\n');
    }
    if (collapsedNodes.length > 0) {
      nodesList += '\nNodos cerrados:\n' +
        collapsedNodes.map((n) => `- ${n.nodeId}`).join('\n');
    }
    if (!nodesList) {
      nodesList = '(ningún nodo - conversación nueva)';
    }

    // Load messages from current active node
    let nodeConversation = '';
    if (flowData.currentNodeId) {
      const currentNode = activeNodes.find((n) => n.nodeId === flowData.currentNodeId);
      if (currentNode?.messageIds?.length) {
        const msgs = await this.nodeMessageService.loadNodeMessages(
          currentNode.messageIds,
          conversationId,
          this.prisma,
        );
        if (msgs.length > 0) {
          nodeConversation = '\n\nConversación del nodo actual:\n' +
            msgs.map((m) => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content}`).join('\n');
        }
      }
    }

    const userMessage = `${nodesList}${nodeConversation}\n\nMensaje del usuario: "${transcription}"`;

    // 4. Call LLM for analysis (with retry on parse failure)
    const chatMessages: { role: string; content: string }[] = [
      { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ];

    const apiCalls: CreateApiCallData[] = [];
    let operations: FlowOperation[] | null = null;
    let totalAnalyzerCost = 0;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const llmResult = await this.langSmithService.traceLLM(
        () => this.kimiClient.rawChat(chatMessages, 250),
        chatMessages,
      );

      apiCalls.push({
        messageId,
        apiType: 'kimi_flow_analyzer' as ApiType,
        operation: attempt === 1 ? 'flow_analysis' : 'flow_analysis_retry',
        tokensInput: llmResult.tokensInput,
        tokensOutput: llmResult.tokensOutput,
        costUsd: llmResult.costUsd,
        latencyMs: llmResult.latencyMs,
      });
      totalAnalyzerCost += llmResult.costUsd;

      const parseResult = this.parseOperations(llmResult.response);
      if (parseResult !== null) {
        operations = parseResult;
        break;
      }

      // Parse failed — retry with error feedback
      if (attempt === 1) {
        this.logger.warn(`FlowAnalyzer: parse failed (attempt 1), retrying with error feedback`);
        chatMessages.push(
          { role: 'assistant', content: llmResult.response },
          { role: 'user', content: `Error: tu respuesta no es un JSON válido con el formato { "operations": [...] }. Corrige y responde SOLO el JSON.` },
        );
      }
    }

    // If both attempts failed, mark as unanalyzed
    if (operations === null) {
      this.logger.error(`FlowAnalyzer: parse failed after 2 attempts, skipping analysis`);
      operations = [];

      // Add message to current node anyway so it's not lost
      const fallbackFlowData = this.applyOperations(flowData, [], messageId);
      await this.flowCacheService.save(conversationId, fallbackFlowData);

      return {
        sessionId,
        flowOperations: [],
        flowData: fallbackFlowData,
        apiCalls: [...existingApiCalls, ...apiCalls],
        totalCost: existingCost + totalAnalyzerCost,
      };
    }

    // 5. Log operations
    const opsLog = operations.length === 0
      ? 'ops=[]'
      : 'ops=[' + operations.map((o) => `${o.op}(${o.label || o.nodeId || ''})`).join(', ') + ']';
    this.logger.log(`FlowAnalyzer: ${opsLog}`);

    // 6. Apply operations to flow data
    const updatedFlowData = this.applyOperations(flowData, operations, messageId);

    // 7. Handle end operation
    const hasEnd = operations.some((o) => o.op === 'end');
    if (hasEnd) {
      await this.flowCacheService.save(conversationId, updatedFlowData);
      await this.flowCacheService.flushToDb(conversationId, sessionId);
      await this.sessionRepository.close(sessionId, 'end_conversation');
      await this.flowCacheService.clear(conversationId);
    } else {
      await this.flowCacheService.save(conversationId, updatedFlowData);
    }

    return {
      sessionId,
      flowOperations: operations,
      flowData: updatedFlowData,
      apiCalls: [...existingApiCalls, ...apiCalls],
      totalCost: existingCost + totalAnalyzerCost,
    };
  }

  /**
   * Returns FlowOperation[] on success, null on parse failure.
   * Empty array [] = valid response (no changes needed).
   * null = invalid JSON or missing operations field.
   */
  private parseOperations(response: string): FlowOperation[] | null {
    try {
      const cleaned = response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed.operations)) return null;

      return parsed.operations.filter((op: any) => {
        if (!op?.op || !VALID_OPS.includes(op.op)) return false;
        if (op.op === 'create' && !op.label) return false;
        if ((op.op === 'close' || op.op === 'reopen' || op.op === 'focus') && !op.nodeId) return false;
        return true;
      });
    } catch {
      this.logger.warn(`FlowAnalyzer: failed to parse response: "${response}"`);
    }
    return null;
  }

  private applyOperations(flowData: FlowData, operations: FlowOperation[], messageId?: string): FlowData {
    const nodes = [...flowData.nodes.map((n) => ({ ...n, messageIds: [...n.messageIds] }))];
    let currentNodeId = flowData.currentNodeId;

    for (const op of operations) {
      switch (op.op) {
        case 'create': {
          const newNode: FlowNode = {
            nodeId: op.label!,
            parentId: currentNodeId,
            status: 'active',
            understanding: op.label!,
            messageIds: [],
          };
          nodes.push(newNode);
          currentNodeId = newNode.nodeId;
          break;
        }

        case 'close': {
          const node = nodes.find((n) => n.nodeId === op.nodeId);
          if (node) {
            node.status = 'collapsed';
            if (currentNodeId === op.nodeId) {
              const firstActive = nodes.find((n) => n.status === 'active' || n.status === 'reopened');
              currentNodeId = firstActive?.nodeId || null;
            }
          }
          break;
        }

        case 'reopen': {
          const node = nodes.find((n) => n.nodeId === op.nodeId && n.status === 'collapsed');
          if (node) {
            node.status = 'active';
          }
          break;
        }

        case 'focus': {
          const node = nodes.find((n) => n.nodeId === op.nodeId && (n.status === 'active' || n.status === 'reopened'));
          if (node) {
            currentNodeId = node.nodeId;
          }
          break;
        }

        case 'end': {
          nodes.forEach((n) => {
            if (n.status !== 'collapsed') n.status = 'collapsed';
          });
          currentNodeId = null;
          break;
        }
      }
    }

    // Add messageId to the node with focus AFTER all ops
    if (currentNodeId && messageId) {
      const focusNode = nodes.find((n) => n.nodeId === currentNodeId);
      if (focusNode) focusNode.messageIds.push(messageId);
    }

    return { currentNodeId, nodes };
  }
}
