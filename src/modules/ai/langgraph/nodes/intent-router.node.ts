import { Injectable, Logger } from '@nestjs/common';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { NodeSessionRepository } from '../../../nodes/repositories/node-session.repository';
import { NodeRunnerService } from '../../../nodes/services/node-runner.service';
import { NodeFunctionRegistry } from '../../../nodes/functions/node-function.registry';
import { NodeContext } from '../../../nodes/functions/node-function.context';
import { buildVirtualRouterNode, ROUTER_PRE_CODE, ROUTER_POST_CODE } from '../../../nodes/router-config';

@Injectable()
export class IntentRouterNode {
  private readonly logger = new Logger(IntentRouterNode.name);

  constructor(
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly nodeRunner: NodeRunnerService,
    private readonly fnRegistry: NodeFunctionRegistry,
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
      apiCalls: existingApiCalls,
      totalCost: existingCost,
      error: previousError,
    } = state;

    if (previousError) return {};

    // 1. Check if there's an active nodeSession with currentNodeId → skip router, go to custom_node
    const existingSession = await this.nodeSessionRepo.findActiveByConversationId(conversationId);
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

    // Build NodeContext (flow and nodeSession may be null)
    const ctx = new NodeContext();
    ctx.messageId = messageId;
    ctx.userId = userId;
    ctx.conversationId = conversationId;
    ctx.transcription = transcription;
    ctx.history = history;
    ctx.instanceName = instanceName;
    ctx.clientPhone = clientPhone;
    ctx.node = virtualRouterNode;

    // If there's an existing session (without currentNodeId), use it
    if (existingSession) {
      ctx.nodeSession = existingSession;
      ctx.flow = existingSession.flow as any;
    }

    try {
      // Execute preCode
      let systemPromptExtra = '';
      if (ROUTER_PRE_CODE.length > 0) {
        this.logger.log(`Running router preCode: [${ROUTER_PRE_CODE.join(', ')}]`);
        systemPromptExtra = await this.fnRegistry.executePreCode(ROUTER_PRE_CODE, ctx);
      }

      // Resolve postCode with defaults
      const postCodes = this.fnRegistry.mergePostCode(JSON.stringify(ROUTER_POST_CODE));
      const resolvedPostCode = this.fnRegistry.resolvePostCode(postCodes);
      const allDefinitions = [...resolvedPostCode.definitions];

      // Run via NodeRunner
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
        () =>
          this.nodeRunner.run({
            node: virtualRouterNode,
            transcription,
            imageUrl,
            history,
            systemPromptExtra,
            toolDefinitions: allDefinitions,
            toolHandlers: new Map(),
            terminationNames: resolvedPostCode.terminationNames,
            fnRegistry: this.fnRegistry,
            ctx,
          }),
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

      // Execute postCode handler if termination
      let routerAction: 'responder' | 'closeSession' | 'findFlowForIntent' | null = null;

      if (result.toolResult?.terminationTool) {
        const toolName = result.toolResult.terminationTool;
        const handler = resolvedPostCode.handlers.get(toolName);
        if (handler) {
          this.logger.log(`Running router postCode: "${toolName}"`);
          ctx.toolCallArgs = result.toolResult.terminationArgs ?? undefined;
          ctx.llmResult = result.toolResult;
          await handler.instance[handler.method](ctx);
          ctx.toolCallArgs = undefined;
        }

        if (toolName === 'findFlowForIntent') {
          routerAction = 'findFlowForIntent';
        } else if (toolName === 'closeSession') {
          routerAction = 'closeSession';
        } else {
          routerAction = 'responder';
        }
      }

      // Reload nodeSession to get updated currentNodeId (findFlowForIntent may have changed it)
      const updatedSession = await this.nodeSessionRepo.findActiveByConversationId(conversationId);

      this.logger.log(
        `IntentRouter: action=${routerAction}, intent=${result.intent}, ${result.tokensInput}+${result.tokensOutput} tokens`,
      );

      const preferredFormat: 'audio' | 'text' =
        messageType === 'voice' || messageType === 'audio' ? 'audio' : 'text';

      return {
        responseText: '',
        intent: result.intent,
        preferredFormat,
        routerAction,
        currentNodeId: updatedSession?.currentNodeId ?? null,
        flowId: updatedSession?.flowId ?? null,
        nodeSessionId: updatedSession?.id ?? null,
        apiCalls: [...existingApiCalls, apiCall],
        totalCost: existingCost + result.costUsd,
      };
    } catch (error) {
      this.logger.error(`IntentRouter failed: ${error.message}`);
      return {
        error: { step: 'intent_router', apiName: 'kimi_llm', message: error.message },
      };
    }
  }
}
