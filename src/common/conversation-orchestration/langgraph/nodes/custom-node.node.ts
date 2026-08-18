import { Injectable, Logger } from '@nestjs/common';
import { ApiName, MessageType } from '@prisma/client';
import { KimiApiError } from '@common/external-integrations/kimi.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { NodeRunnerService } from '@modules/nodes/services/node-runner.service';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { NodeContext } from '@modules/nodes/functions/node-function.context';

const MAX_TRANSITIONS = 5;

@Injectable()
export class CustomNode {
  private readonly logger = new Logger(CustomNode.name);

  constructor(
    private readonly nodeRunner: NodeRunnerService,
    private readonly nodeRepo: NodeRepository,
    private readonly langSmithService: LangSmithService,
    private readonly limitsService: LimitsService,
    private readonly internalApi: InternalApiClient,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const {
      transcription,
      conversationId,
      messageId,
      messageType,
      imageUrl,
      tenantId,
      instanceName,
      clientPhone,
      nodeSessionId,
      sessionStore,
      queueContext,
      error: previousError,
    } = state;

    if (previousError) return {};

    let activeNodeId = state.currentNodeId;
    const apiCalls = [...(state.apiCalls ?? [])];
    let totalCost = state.totalCost ?? 0;
    const nodeTransitions = [...(state.nodeTransitions ?? [])];
    let allSideEffects = [...(state.sideEffects ?? [])];
    let lastResponse = '';
    let lastIntent = '';
    let lastPreCodeContext: string | null = null;
    let lastPreferredFormat: 'audio' | 'text' = 'text';

    for (let iteration = 0; iteration <= MAX_TRANSITIONS; iteration++) {
      if (!activeNodeId) {
        throw new Error(
          `CustomNode: currentNodeId is null for conversation ${conversationId}. ` +
          `This node should only be reached when a flow has been activated.`,
        );
      }

      // Load session
      let session: import('@common/conversation-session/stores/node-session-store.interface').SessionData | null = null;
      if (nodeSessionId) {
        session = await sessionStore.findById(nodeSessionId);
        // If session is waiting_queue and this is a queue response, reactivate it
        if (session?.status === 'waiting_queue' && transcription?.startsWith('[RESPUESTA DE COLA')) {
          await sessionStore.updateStatus(nodeSessionId, 'active');
          session = { ...session, status: 'active' };
        } else if (session?.status === 'waiting_queue') {
          // Client sent a message while waiting for queue — ignore, don't run LLM
          this.logger.log(`CustomNode: session waiting_queue, ignoring client message for ${conversationId}`);
          return { responseText: '', intent: 'waiting_queue', sideEffects: allSideEffects, apiCalls, totalCost, nodeTransitions };
        }
      }

      // Load node — use cache only on first iteration
      let activeNode: import('@prisma/client').Node;
      const cached = (iteration === 0)
        ? session?.cachedNodeData as import('@common/conversation-session/stores/node-session-store.interface').CachedNodeData | null
        : null;
      if (cached?.node) {
        activeNode = cached.node;
        this.logger.log(`CustomNode: using cached node "${activeNode.name}" (${activeNodeId})`);
      } else {
        const dbNode = await this.nodeRepo.findById(activeNodeId);
        if (!dbNode) {
          throw new Error(`CustomNode: node ${activeNodeId} not found`);
        }
        activeNode = dbNode;
      }

      // Validar que el nodo de DB tiene todos definidos — son obligatorios
      const hasTodos = activeNode.todos &&
        (Array.isArray(activeNode.todos) ? activeNode.todos.length > 0 : true);
      if (!hasTodos) {
        throw new Error(
          `Node "${activeNode.name}" (${activeNode.id}) has no todos defined. ` +
          `Todos are required for every DB node — define them in node-sql and re-run the SQL.`,
        );
      }

      // Load contact info once on first iteration
      let clientName: string | null = null;
      let clientId: string | null = null;
      if (iteration === 0) {
        try {
          const conv = await this.internalApi.getConversationFull(conversationId);
          clientName = conv.client?.name ?? null;
          clientId = conv.client?.id ?? null;
        } catch {
          // non-fatal — continue without client info
        }
      }

      // Load history — skip on internal transitions (iteration > 0)
      // because the new node gets context via flowSummary in systemPrompt
      let history: { role: string; content: string }[] = [];
      if (iteration === 0) {
        const messages = await this.internalApi.getMessageHistory(conversationId, 31);
        const previousMessages = messages.filter((m) => m.id !== messageId);
        history = previousMessages
          .filter((m) => m.content || m.mediaRelativePath)
          .map((m) => ({
            role: m.direction === 'incoming' ? 'user' : 'assistant',
            content: m.mediaRelativePath
              ? `${m.content} [messageId:${m.id}]`
              : m.content,
          }));

        if (queueContext) {
          history.push({ role: 'assistant', content: 'He enviado el comprobante al supervisor para verificación, esperando respuesta...' });
          history.push({ role: 'system', content: queueContext });
        }
      }

      this.logger.log(
        `CustomNode: executing node "${activeNode.name}" (${activeNodeId}) for conversation ${conversationId}`,
      );

      // Build NodeContext
      const ctx = new NodeContext();
      ctx.messageId = messageId;
      ctx.tenantId = tenantId;
      ctx.conversationId = conversationId;
      ctx.transcription = transcription;
      ctx.history = history;
      ctx.instanceName = instanceName;
      ctx.clientPhone = clientPhone;
      ctx.clientName = clientName;
      ctx.clientId = clientId;
      ctx.imageUrl = imageUrl;
      ctx.mediaRelativePath = state.mediaRelativePath ?? null;
      ctx.node = activeNode;
      ctx.isTest = state.isTest ?? false;
      ctx.sessionStore = sessionStore;

      if (session) {
        ctx.nodeSession = session;
        if (cached?.flow) {
          ctx.flow = cached.flow;
        } else if (session.flow) {
          ctx.flow = session.flow;
        }
      } else if (state.flowId) {
        ctx.flow = await this.nodeRepo.findFlowWithNodes(state.flowId);
      }

      if (ctx.nodeSession?.flowSummary) {
        activeNode.systemPrompt =
          activeNode.systemPrompt +
          '\n\n--- PROGRESO PREVIO DEL FLUJO ---\n' +
          ctx.nodeSession.flowSummary +
          '\n--- FIN PROGRESO ---';
      }

      try {
        const traceMessages = [
          ...history,
          {
            role: 'user',
            content: imageUrl
              ? `${transcription} [imagen: ${imageUrl}] [messageId:${messageId}]`
              : transcription,
          },
        ];

        const result = await this.langSmithService.traceLLM(
          () => this.nodeRunner.runNode(ctx, activeNode, transcription, imageUrl, history),
          traceMessages,
        );

        const apiCall: CreateApiCallData = {
          messageId,
          apiType: 'kimi_llm',
          operation: 'chat',
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
        };

        const actualCredits = this.limitsService.calculateCreditsFromLlm(
          result.tokensInput,
          result.tokensOutput,
        );
        await this.internalApi.incrementCreditsUsed(tenantId, actualCredits);
        this.logger.log(
          `CustomNode: incremented ${actualCredits.toFixed(3)} credits (${result.tokensInput}in+${result.tokensOutput}out)`,
        );

        lastPreferredFormat =
          messageType === MessageType.voice || messageType === MessageType.audio
            ? 'audio'
            : 'text';

        this.logger.log(
          `CustomNode: intent=${result.intent}, format=${lastPreferredFormat}, response="${result.response.substring(0, 80)}"`,
        );

        const terminationTool = result.toolResult?.terminationTool ?? null;
        if (terminationTool === 'transitionToNode') {
          const updatedSession = await sessionStore.findById(ctx.nodeSession.id);
          const newNodeId = updatedSession?.currentNodeId ?? null;
          nodeTransitions.push({ from: activeNodeId, to: newNodeId, reason: `transitionToNode: ${result.toolResult?.terminationArgs?.transitionCode ?? ''}` });
        } else if (terminationTool) {
          nodeTransitions.push({ from: activeNodeId, to: null, reason: terminationTool });
        } else {
          nodeTransitions.push({ from: activeNodeId, to: activeNodeId, reason: `responder: ${result.intent}` });
        }

        apiCalls.push(apiCall);
        totalCost += result.costUsd;
        allSideEffects = [...allSideEffects, ...ctx.sideEffects];
        lastResponse = result.response;
        lastIntent = result.intent;
        lastPreCodeContext = result.preCodeContext ?? null;

        // outOfPath → let workflow route to flow_router
        if (terminationTool === 'outOfPath') {
          return {
            responseText: lastResponse, intent: lastIntent, preferredFormat: lastPreferredFormat,
            sideEffects: allSideEffects, apiCalls, totalCost, preCodeContext: lastPreCodeContext,
            nodeTransitions, routerAction: 'outOfPath',
          };
        }

        // transitionToNode → loop internally to the new node
        if (terminationTool === 'transitionToNode') {
          const updatedSession2 = await sessionStore.findById(ctx.nodeSession.id);
          const nextNodeId = updatedSession2?.currentNodeId ?? null;
          if (!nextNodeId || nextNodeId === activeNodeId) {
            // Transition failed (node not found) — stop looping
            this.logger.log(`CustomNode: transitionToNode failed (no node change), stopping`);
            return {
              responseText: lastResponse, intent: lastIntent, preferredFormat: lastPreferredFormat,
              sideEffects: allSideEffects, apiCalls, totalCost, preCodeContext: lastPreCodeContext,
              nodeTransitions,
            };
          }
          activeNodeId = nextNodeId;
          this.logger.log(`CustomNode: transitioning to node ${activeNodeId}`);
          continue;
        }

        // Normal termination — cache and return
        if (!cached && ctx.nodeSession) {
          sessionStore.setCachedNodeData(ctx.nodeSession.id, {
            node: activeNode,
            flow: ctx.flow ?? null,
            preCodeResult: result.preCodeContext ?? null,
          }).catch((err) => this.logger.warn(`Failed to cache node data: ${err.message}`));
        }

        return {
          responseText: lastResponse, intent: lastIntent, preferredFormat: lastPreferredFormat,
          sideEffects: allSideEffects, apiCalls, totalCost, preCodeContext: lastPreCodeContext,
          nodeTransitions,
        };
      } catch (error) {
        this.logger.error(`CustomNode: failed: ${error.message}`);
        return {
          error: error instanceof KimiApiError
            ? { apiName: ApiName.kimi_llm, message: error.message }
            : { message: error.message },
        };
      }
    }

    this.logger.error(`CustomNode: max transitions (${MAX_TRANSITIONS}) reached for ${conversationId}`);
    return {
      responseText: lastResponse, intent: lastIntent, preferredFormat: lastPreferredFormat,
      sideEffects: allSideEffects, apiCalls, totalCost, preCodeContext: lastPreCodeContext,
      nodeTransitions,
    };
  }
}
