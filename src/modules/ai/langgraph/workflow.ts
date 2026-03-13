import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, END, START } from '@langchain/langgraph';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { WorkflowState, WorkflowStateType } from './state.interface';
import { InputRouterNode } from './nodes/input-router.node';
import { IntentRouterNode } from './nodes/intent-router.node';
import { CustomNode } from './nodes/custom-node.node';
import { OutputRouterNode } from './nodes/output-router.node';
import { FinalizeNode } from './nodes/finalize.node';
import { IncomingMessageEvent } from '../ai-agent.service';
import { NodeSessionStore } from '@modules/nodes/stores/node-session-store.interface';

export interface WorkflowResult {
  responseText: string;
  intent: string;
  currentNodeId: string | null;
  sideEffects: any[];
  totalCost: number;
  error: any;
  preCodeContext: string | null;
  nodeTransitions: Array<{ from: string | null; to: string | null; reason: string }>;
}

@Injectable()
export class AiWorkflow {
  private readonly logger = new Logger(AiWorkflow.name);
  private graph: any;

  constructor(
    private readonly inputRouterNode: InputRouterNode,
    private readonly intentRouterNode: IntentRouterNode,
    private readonly customNode: CustomNode,
    private readonly outputRouterNode: OutputRouterNode,
    private readonly finalizeNode: FinalizeNode,
    private readonly langSmithService: LangSmithService,
  ) {
    this.graph = this.buildGraph();
  }

  private buildGraph() {
    const builder = new StateGraph(WorkflowState)
      .addNode('input_router', (state: WorkflowStateType) =>
        this.inputRouterNode.execute(state),
      )
      .addNode('intent_router', (state: WorkflowStateType) =>
        this.intentRouterNode.execute(state),
      )
      .addNode('custom_node', (state: WorkflowStateType) =>
        this.customNode.execute(state),
      )
      .addNode('output_router', (state: WorkflowStateType) =>
        this.outputRouterNode.execute(state),
      )
      .addNode('finalize', (state: WorkflowStateType) =>
        this.finalizeNode.execute(state),
      )

      // START → input_router → intent_router (decides: router or custom_node)
      .addEdge(START, 'input_router')
      .addEdge('input_router', 'intent_router')

      // intent_router → custom_node (has currentNodeId) OR output_router (router handled it) OR finalize (error)
      .addConditionalEdges('intent_router', (state: WorkflowStateType) => {
        if (state.error) return 'finalize';
        // If currentNodeId is set and routerAction is null → session had active node, go to custom_node
        // If routerAction is findFlowForIntent → flow activated, go to custom_node
        if (state.currentNodeId && (state.routerAction === null || state.routerAction === 'findFlowForIntent')) {
          return 'custom_node';
        }
        // Router handled it (responder, closeSession, etc.) → output_router
        return 'output_router';
      })

      // custom_node → intent_router (exitFlow) OR output_router
      .addConditionalEdges('custom_node', (state: WorkflowStateType) => {
        if (state.error) return 'finalize';
        if (state.routerAction === 'exitFlow') return 'intent_router';
        return 'output_router';
      })
      .addEdge('output_router', 'finalize')
      .addEdge('finalize', END);

    return builder.compile();
  }

  async execute(
    payload: IncomingMessageEvent,
    sessionStore: NodeSessionStore,
    isTest = false,
  ): Promise<WorkflowResult> {
    const initialState: Partial<WorkflowStateType> = {
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      instanceName: payload.instanceName,
      clientPhone: payload.clientPhone,
      userId: payload.userId,
      messageType: payload.messageType,
      content: payload.content,
      mediaRelativePath: payload.mediaRelativePath,
      mediaMetadata: payload.mediaMetadata,
      apiCalls: [],
      sideEffects: [],
      totalCost: 0,
      isTest,
      sessionStore,
      error: null,
      currentNodeId: null,
      flowId: null,
      nodeSessionId: null,
      routerAction: null,
      nodeTransitions: [],
    };

    const result = await this.langSmithService.tracePipeline(
      async () => {
        const res = await this.graph.invoke(initialState);
        this.logger.log(
          `Workflow completed for ${payload.conversationId} | cost=$${res.totalCost?.toFixed(6)}${isTest ? ' [TEST]' : ''}`,
        );
        return res;
      },
      {
        conversationId: payload.conversationId,
        clientPhone: payload.clientPhone,
        mode: isTest ? 'TEST' : 'AI',
      },
    );

    return {
      responseText: result.responseText ?? '',
      intent: result.intent ?? '',
      currentNodeId: result.currentNodeId ?? null,
      sideEffects: result.sideEffects ?? [],
      totalCost: result.totalCost ?? 0,
      error: result.error ?? null,
      preCodeContext: result.preCodeContext ?? null,
      nodeTransitions: result.nodeTransitions ?? [],
    };
  }
}
