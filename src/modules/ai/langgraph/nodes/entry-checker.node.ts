import { Injectable, Logger } from '@nestjs/common';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { IntentRepository } from '@modules/nodes/repositories/intent.repository';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { KimiClient } from '../../clients/kimi.client';

interface TodoDefinition {
  id: string;
  name: string;
  description?: string;
}

interface FlowTransitionWithTodos {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  transitionCode: string;
  requiredTodos: string[] | null;
  toNode: { id: string; name: string };
}

/**
 * EntryCheckerNode — hardcoded LangGraph node.
 *
 * Only activates when fromHitl=true AND there are >1 messages in the conversation.
 *
 * Flow:
 *   1. Count messages — if ≤1, skip (set fromHitl=false, let intent_router handle)
 *   2. If >5 messages, conversation-analysis should have already run (handled by caller)
 *   3. Detect intent from recent messages (LLM call)
 *   4. If no clear intent → skip to intent_router
 *   5. If intent matched to a flow:
 *      a. Find active NodeSession for that flow
 *      b. Walk through node todos to find current position
 *      c. Set currentNodeId so custom_node picks it up
 */
@Injectable()
export class EntryCheckerNode {
  private readonly logger = new Logger(EntryCheckerNode.name);

  constructor(
    private readonly internalApi: InternalApiClient,
    private readonly intentRepo: IntentRepository,
    private readonly nodeRepo: NodeRepository,
    private readonly langSmith: LangSmithService,
    private readonly kimiClient: KimiClient,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    if (state.error) return {};

    // Only runs when triggered from HITL→AI transition
    if (!state.fromHitl) return {};

    const {
      conversationId,
      tenantId,
      transcription,
      messageId,
      sessionStore,
      apiCalls: existingApiCalls,
      totalCost: existingCost,
    } = state;

    // 1. Get message history to determine count
    const messages = await this.internalApi.getMessageHistory(conversationId, 50);

    if (messages.length <= 1) {
      this.logger.log(`EntryChecker: ≤1 messages, skipping → intent_router`);
      return { fromHitl: false };
    }

    this.logger.log(`EntryChecker: ${messages.length} messages found, analyzing intent`);

    // 2. Build history for LLM (last 20 messages max)
    const recentMessages = messages.slice(-20);
    const history = recentMessages
      .filter((m) => m.content)
      .map((m) => ({
        role: m.direction === 'incoming' ? 'user' : 'assistant',
        content: m.content,
      }));

    // 3. Load intents for tenant
    const intents = await this.intentRepo.findByTenantId(tenantId);
    if (intents.length === 0) {
      this.logger.log(`EntryChecker: no intents configured, skipping → intent_router`);
      return { fromHitl: false };
    }

    const intentList = intents.map((i) => `- ${i.name}`).join('\n');

    // 4. Detect intent via LLM
    const systemPrompt = `Eres un clasificador de intenciones. Analiza la conversación y determina si hay una intención clara del cliente.

Intenciones disponibles:
${intentList}

Responde ÚNICAMENTE con el nombre exacto de la intención si la detectas claramente, o con "ninguna" si no hay intención clara o la conversación es solo saludo/despedida.`;

    let detectedIntentName: string | null = null;
    let apiCall: CreateApiCallData | null = null;
    let callCost = 0;

    try {
      const llmMessages = [
        { role: 'system', content: systemPrompt },
        ...history,
        {
          role: 'user',
          content: `Basándote en esta conversación, ¿cuál es la intención del cliente? Responde solo con el nombre de la intención o "ninguna".`,
        },
      ];

      const result = await this.langSmith.traceLLM(
        () => this.kimiClient.rawChat(llmMessages, 100),
        history,
      );

      const rawResponse = result.response?.trim().toLowerCase() ?? 'ninguna';
      callCost = result.costUsd ?? 0;

      apiCall = {
        messageId,
        apiType: 'kimi_llm',
        operation: 'chat',
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
      };

      if (rawResponse !== 'ninguna') {
        // Match against known intents (case-insensitive)
        const matched = intents.find(
          (i) => i.name.toLowerCase() === rawResponse || rawResponse.includes(i.name.toLowerCase()),
        );
        if (matched) {
          detectedIntentName = matched.name;
          this.logger.log(`EntryChecker: detected intent="${matched.name}" flowId=${matched.flowId}`);
        }
      }
    } catch (err) {
      this.logger.error(`EntryChecker: LLM call failed: ${err.message}`);
      // On error, just skip to intent_router
      return { fromHitl: false };
    }

    const updatedApiCalls = apiCall
      ? [...existingApiCalls, apiCall]
      : existingApiCalls;
    const updatedCost = existingCost + callCost;

    // 5. No clear intent → go to intent_router
    if (!detectedIntentName) {
      this.logger.log(`EntryChecker: no clear intent detected → intent_router`);
      return { fromHitl: false, apiCalls: updatedApiCalls, totalCost: updatedCost };
    }

    const matchedIntent = intents.find((i) => i.name === detectedIntentName);
    if (!matchedIntent?.flowId) {
      this.logger.log(`EntryChecker: intent "${detectedIntentName}" has no flow → intent_router`);
      return {
        intent: detectedIntentName,
        fromHitl: false,
        apiCalls: updatedApiCalls,
        totalCost: updatedCost,
      };
    }

    const flowId = matchedIntent.flowId;

    // 6. Check for active NodeSession for this flow
    const activeSession = await sessionStore.findActiveOrWaitingByConversationId(conversationId);

    if (!activeSession?.currentNodeId || activeSession.flowId !== flowId) {
      // No active session in this flow → activate the flow from the start (routerNode)
      const flow = await this.nodeRepo.findFlowWithNodes(flowId);
      if (!flow) {
        this.logger.log(`EntryChecker: flow ${flowId} not found → intent_router`);
        return {
          intent: detectedIntentName,
          fromHitl: false,
          apiCalls: updatedApiCalls,
          totalCost: updatedCost,
        };
      }

      // Create/update session pointing to the router node of the flow
      const session = await sessionStore.findOrCreate(conversationId, flowId);
      const updatedSession = await sessionStore.updateCurrentNode(
        session.id,
        flow.routerNodeId,
        detectedIntentName,
        flowId,
      );

      this.logger.log(
        `EntryChecker: new flow session → currentNodeId=${flow.routerNodeId} flowId=${flowId}`,
      );

      return {
        intent: detectedIntentName,
        currentNodeId: flow.routerNodeId,
        flowId,
        nodeSessionId: updatedSession.id,
        routerAction: null,
        fromHitl: false,
        apiCalls: updatedApiCalls,
        totalCost: updatedCost,
        nodeTransitions: [
          ...(state.nodeTransitions ?? []),
          { from: 'entry_checker', to: flow.routerNodeId, reason: `intent: ${detectedIntentName} (new flow)` },
        ],
      };
    }

    // 7. Active session found — walk todos to find correct node position
    const currentNodeId = activeSession.currentNodeId;
    const completedTodos = (activeSession.completedTodos as Record<string, boolean> | null) ?? {};

    this.logger.log(
      `EntryChecker: active session found currentNodeId=${currentNodeId}, completedTodos=${JSON.stringify(completedTodos)}`,
    );

    // Load flow with transitions to check if any transition is ready
    const flow = await this.nodeRepo.findFlowWithNodes(flowId);
    if (flow) {
      const transitions = (flow.transitions ?? []) as unknown as FlowTransitionWithTodos[];
      const fromCurrentNode = transitions.filter((tr) => tr.fromNodeId === currentNodeId);

      // Check if happy path (first transition with required todos) is complete
      const happyPath = fromCurrentNode.find(
        (tr) => tr.requiredTodos && tr.requiredTodos.length > 0,
      );

      if (happyPath) {
        const allDone = happyPath.requiredTodos!.every((id) => completedTodos[id]);
        if (allDone) {
          // Happy path complete → move to next node
          const updatedSession = await sessionStore.updateCurrentNode(
            activeSession.id,
            happyPath.toNodeId,
            detectedIntentName,
            flowId,
          );

          this.logger.log(
            `EntryChecker: happy path complete → moving to ${happyPath.toNodeId}`,
          );

          return {
            intent: detectedIntentName,
            currentNodeId: happyPath.toNodeId,
            flowId,
            nodeSessionId: updatedSession.id,
            routerAction: null,
            fromHitl: false,
            apiCalls: updatedApiCalls,
            totalCost: updatedCost,
            nodeTransitions: [
              ...(state.nodeTransitions ?? []),
              {
                from: `entry_checker(${currentNodeId})`,
                to: happyPath.toNodeId,
                reason: `happy path complete: ${happyPath.transitionCode}`,
              },
            ],
          };
        }
      }
    }

    // Stay in current node — todos not complete yet, let custom_node continue
    this.logger.log(
      `EntryChecker: todos not complete, resuming in currentNodeId=${currentNodeId}`,
    );

    return {
      intent: detectedIntentName,
      currentNodeId,
      flowId,
      nodeSessionId: activeSession.id,
      routerAction: null,
      fromHitl: false,
      apiCalls: updatedApiCalls,
      totalCost: updatedCost,
      nodeTransitions: [
        ...(state.nodeTransitions ?? []),
        {
          from: 'entry_checker',
          to: currentNodeId,
          reason: `resuming flow, pending todos`,
        },
      ],
    };
  }
}
