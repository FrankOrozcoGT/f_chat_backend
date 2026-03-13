import { Injectable, Logger } from '@nestjs/common';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { NodeRunnerService } from '@modules/nodes/services/node-runner.service';
import { NodeContext } from '@modules/nodes/functions/node-function.context';
import { buildVirtualRouterNode } from '@modules/nodes/router-config';

@Injectable()
export class IntentRouterNode {
  private readonly logger = new Logger(IntentRouterNode.name);

  constructor(
    private readonly nodeRunner: NodeRunnerService,
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
      userId,
      instanceName,
      clientPhone,
      sessionStore,
      apiCalls: existingApiCalls,
      totalCost: existingCost,
      error: previousError,
    } = state;

    if (previousError) return {};

    // 1. Check if there's an active nodeSession with currentNodeId → skip router, go to custom_node
    const existingSession = await sessionStore.findActiveByConversationId(conversationId);
    if (existingSession?.currentNodeId) {
      this.logger.log(
        `IntentRouter: active session found, currentNodeId=${existingSession.currentNodeId} → custom_node`,
      );
      return {
        currentNodeId: existingSession.currentNodeId,
        flowId: existingSession.flowId,
        nodeSessionId: existingSession.id,
        routerAction: null,
      };
    }

    // 2. No currentNodeId → execute hardcoded router
    this.logger.log(`IntentRouter: no active node, executing hardcoded router`);

    // Load history
    const messages = await this.internalApi.getMessageHistory(conversationId, 31);
    const previousMessages = messages.slice(0, -1);
    const history = previousMessages
      .filter((m) => m.content)
      .map((m) => ({
        role: m.direction === 'incoming' ? 'user' : 'assistant',
        content: m.content,
      }));

    const virtualRouterNode = buildVirtualRouterNode();

    // Build NodeContext
    const ctx = new NodeContext();
    ctx.messageId = messageId;
    ctx.userId = userId;
    ctx.conversationId = conversationId;
    ctx.transcription = transcription;
    ctx.history = history;
    ctx.instanceName = instanceName;
    ctx.clientPhone = clientPhone;
    ctx.node = virtualRouterNode;
    ctx.isTest = state.isTest ?? false;
    ctx.sessionStore = sessionStore;

    // Ensure a session exists (create without flow if needed)
    const session = existingSession ?? await sessionStore.findOrCreate(conversationId);
    ctx.nodeSession = session;
    if (session.flow) {
      ctx.flow = session.flow;
    }

    try {
      const traceMessages = [
        ...history,
        {
          role: 'user',
          content: imageUrl
            ? `${transcription} [imagen: ${imageUrl}]`
            : transcription,
        },
      ];

      const result = await this.langSmithService.traceLLM(
        () => this.nodeRunner.runNode(ctx, virtualRouterNode, transcription, imageUrl, history),
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

      // Increment credits
      const actualCredits = this.limitsService.calculateCreditsFromLlm(
        result.tokensInput,
        result.tokensOutput,
      );
      await this.internalApi.incrementCreditsUsed(userId, actualCredits);

      // Determine router action from termination tool
      let routerAction: 'responder' | 'closeSession' | 'findFlowForIntent' | null = null;

      if (result.toolResult?.terminationTool) {
        const toolName = result.toolResult.terminationTool;
        if (toolName === 'findFlowForIntent') {
          routerAction = 'findFlowForIntent';
        } else if (toolName === 'closeSession') {
          routerAction = 'closeSession';
        } else {
          routerAction = 'responder';
        }
      }

      // Reload nodeSession to get updated currentNodeId (findFlowForIntent may have changed it)
      const updatedSession = await sessionStore.findActiveByConversationId(conversationId);

      this.logger.log(
        `IntentRouter: action=${routerAction}, intent=${result.intent}, ${result.tokensInput}+${result.tokensOutput} tokens`,
      );

      const preferredFormat: 'audio' | 'text' =
        messageType === 'voice' || messageType === 'audio' ? 'audio' : 'text';

      // Register node transitions for test visibility
      const nodeTransitions = [...(state.nodeTransitions ?? [])];
      const newNodeId = updatedSession?.currentNodeId ?? null;
      if (routerAction === 'findFlowForIntent' && newNodeId) {
        nodeTransitions.push({ from: 'router', to: newNodeId, reason: `intent: ${result.intent}` });
      } else if (routerAction === 'closeSession') {
        nodeTransitions.push({ from: 'router', to: null, reason: 'closeSession' });
      } else if (routerAction === 'responder') {
        nodeTransitions.push({ from: 'router', to: null, reason: `responder: ${result.intent}` });
      }

      return {
        responseText: '',
        intent: result.intent,
        preferredFormat,
        routerAction,
        currentNodeId: newNodeId,
        flowId: updatedSession?.flowId ?? null,
        nodeSessionId: updatedSession?.id ?? null,
        sideEffects: ctx.sideEffects,
        apiCalls: [...existingApiCalls, apiCall],
        totalCost: existingCost + result.costUsd,
        nodeTransitions,
      };
    } catch (error) {
      this.logger.error(`IntentRouter failed: ${error.message}`);
      return {
        error: { step: 'intent_router', apiName: 'kimi_llm', message: error.message },
      };
    }
  }
}
