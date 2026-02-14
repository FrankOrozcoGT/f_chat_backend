import { Injectable, Logger } from '@nestjs/common';
import { KimiClient } from '../../clients/kimi.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { FlowCacheService } from '../../services/flow-cache.service';
import { SessionRepository } from '../../repositories/session.repository';
import { ClientMemoryRepository } from '../../repositories/client-memory.repository';
import { WorkflowStateType, FlowData, FlowAction, FlowNode } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { ApiType } from '@prisma/client';

const ANALYZER_SYSTEM_PROMPT = `Eres un analizador de flujo de conversación. Detectas SOLO cambios significativos de dirección o enfoque.

Tu trabajo NO es analizar cada mensaje. La mayoría de veces la respuesta es NONE porque la conversación fluye normalmente.

Solo responde diferente si:
- DIRECTION_CHANGE: el usuario abandona COMPLETAMENTE lo que estaba haciendo para algo totalmente distinto
- SHIFT_FOCUS: el usuario necesita resolver algo puntual que BLOQUEA el objetivo (como un error, un problema técnico, una duda que impide continuar). El contexto anterior ESTORBA y debe colapsarse temporalmente.
- BACK_TO_OBJECTIVE: el usuario resolvió el desvío/bloqueo y vuelve al tema principal
- CREATE: es un tema genuinamente nuevo (NO una pregunta rápida dentro del mismo flujo)
- END_CONVERSATION: despedida clara, la conversación terminó

Una pregunta rápida como "¿cuánto cuesta?" dentro del flujo de un pedido NO es un cambio. Es parte del mismo flujo.

Responde SOLO un JSON válido (sin markdown, sin backticks):
{ "action": "NONE" }
o
{ "action": "CREATE", "label": "descripción corta del tema" }
o
{ "action": "SHIFT_FOCUS", "label": "descripción del bloqueo" }
o
{ "action": "DIRECTION_CHANGE", "label": "nuevo tema" }
o
{ "action": "BACK_TO_OBJECTIVE" }
o
{ "action": "END_CONVERSATION" }`;

@Injectable()
export class FlowAnalyzerNode {
  private readonly logger = new Logger(FlowAnalyzerNode.name);

  constructor(
    private readonly kimiClient: KimiClient,
    private readonly langSmithService: LangSmithService,
    private readonly flowCacheService: FlowCacheService,
    private readonly sessionRepository: SessionRepository,
    private readonly clientMemoryRepository: ClientMemoryRepository,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
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
    const activeLabels =
      activeNodes.length > 0
        ? activeNodes.map((n) => `- ${n.nodeId} (${n.status}): ${n.understanding}`).join('\n')
        : '(ninguno - conversación nueva)';

    const userMessage = `Nodos activos:\n${activeLabels}\n\nMensaje del usuario: "${transcription}"`;

    // 4. Call LLM for analysis
    const messages = [
      { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ];

    const llmResult = await this.langSmithService.traceLLM(
      () => this.kimiClient.rawChat(messages, 150),
    );

    // 5. Parse response
    const analyzerResult = this.parseAnalyzerResponse(llmResult.response);
    const action = analyzerResult.action;
    const label = analyzerResult.label;

    this.logger.log(`FlowAnalyzer: action=${action}${label ? `, label="${label}"` : ''}`);

    // 6. Apply action to flow data
    const updatedFlowData = this.applyAction(flowData, action, label, messageId);

    // 7. Handle END_CONVERSATION
    if (action === 'END_CONVERSATION') {
      await this.flowCacheService.save(conversationId, updatedFlowData);
      await this.flowCacheService.flushToDb(conversationId, sessionId);
      await this.sessionRepository.close(sessionId, 'end_conversation');
      await this.flowCacheService.clear(conversationId);
    } else {
      // Save updated flow to Redis
      await this.flowCacheService.save(conversationId, updatedFlowData);
    }

    // 8. Record API call
    const apiCall: CreateApiCallData = {
      messageId,
      apiType: 'kimi_flow_analyzer' as ApiType,
      operation: 'flow_analysis',
      tokensInput: llmResult.tokensInput,
      tokensOutput: llmResult.tokensOutput,
      costUsd: llmResult.costUsd,
      latencyMs: llmResult.latencyMs,
    };

    return {
      sessionId,
      flowAction: action,
      flowData: updatedFlowData,
      apiCalls: [...existingApiCalls, apiCall],
      totalCost: existingCost + llmResult.costUsd,
    };
  }

  private parseAnalyzerResponse(response: string): { action: FlowAction; label?: string } {
    try {
      // Strip markdown code blocks if present
      const cleaned = response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const validActions: FlowAction[] = [
        'NONE', 'CREATE', 'SHIFT_FOCUS', 'BACK_TO_OBJECTIVE', 'DIRECTION_CHANGE', 'END_CONVERSATION',
      ];
      if (validActions.includes(parsed.action)) {
        return { action: parsed.action, label: parsed.label };
      }
    } catch {
      this.logger.warn(`FlowAnalyzer: failed to parse response: "${response}"`);
    }
    return { action: 'NONE' };
  }

  private applyAction(flowData: FlowData, action: FlowAction, label?: string, messageId?: string): FlowData {
    const nodes = [...flowData.nodes.map((n) => ({ ...n, messageIds: [...n.messageIds] }))];
    let currentNodeId = flowData.currentNodeId;

    switch (action) {
      case 'NONE': {
        // Add message to current node if exists
        if (currentNodeId) {
          const current = nodes.find((n) => n.nodeId === currentNodeId);
          if (current && messageId) current.messageIds.push(messageId);
        }
        break;
      }

      case 'CREATE': {
        const newNode: FlowNode = {
          nodeId: label || `node_${Date.now()}`,
          parentId: currentNodeId,
          status: 'active',
          understanding: label || '',
          messageIds: messageId ? [messageId] : [],
        };
        nodes.push(newNode);
        currentNodeId = newNode.nodeId;
        break;
      }

      case 'SHIFT_FOCUS': {
        // Collapse current active nodes (they "estorban")
        nodes.forEach((n) => {
          if (n.status === 'active') n.status = 'collapsed';
        });
        // Create focus node
        const focusNode: FlowNode = {
          nodeId: label || `focus_${Date.now()}`,
          parentId: currentNodeId,
          status: 'active',
          understanding: label || '',
          messageIds: messageId ? [messageId] : [],
        };
        nodes.push(focusNode);
        currentNodeId = focusNode.nodeId;
        break;
      }

      case 'BACK_TO_OBJECTIVE': {
        // Collapse current focus node
        if (currentNodeId) {
          const current = nodes.find((n) => n.nodeId === currentNodeId);
          if (current) {
            current.status = 'collapsed';
            // Reopen parent
            if (current.parentId) {
              const parent = nodes.find((n) => n.nodeId === current.parentId);
              if (parent) {
                parent.status = 'reopened';
                currentNodeId = parent.nodeId;
                if (messageId) parent.messageIds.push(messageId);
              }
            }
          }
        }
        break;
      }

      case 'DIRECTION_CHANGE': {
        // Collapse ALL active nodes
        nodes.forEach((n) => {
          if (n.status === 'active' || n.status === 'reopened') n.status = 'collapsed';
        });
        // Create new direction node
        const directionNode: FlowNode = {
          nodeId: label || `direction_${Date.now()}`,
          parentId: null,
          status: 'active',
          understanding: label || '',
          messageIds: messageId ? [messageId] : [],
        };
        nodes.push(directionNode);
        currentNodeId = directionNode.nodeId;
        break;
      }

      case 'END_CONVERSATION': {
        // Collapse everything
        nodes.forEach((n) => {
          if (n.status !== 'collapsed') n.status = 'collapsed';
        });
        currentNodeId = null;
        break;
      }
    }

    return { currentNodeId, nodes };
  }
}
