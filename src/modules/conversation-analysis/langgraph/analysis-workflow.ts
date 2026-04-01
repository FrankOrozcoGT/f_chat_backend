import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, END, START } from '@langchain/langgraph';
import {
  AnalysisState,
  AnalysisStateType,
  AnalysisMessage,
} from './analysis-state.interface';
import { AnalysisInputRouterNode } from './nodes/input-router.node';
import { AnalysisNode } from './nodes/analysis.node';

export interface AnalysisWorkflowInput {
  conversationId: string;
  tenantId: string;
  phoneId: string;
  clientId: string | null;
  isGroup: boolean;
  messages: AnalysisMessage[];
  existingIntents: string[];
}

@Injectable()
export class AnalysisWorkflow {
  private readonly logger = new Logger(AnalysisWorkflow.name);
  private graph: any;

  constructor(
    private readonly inputRouterNode: AnalysisInputRouterNode,
    private readonly analysisNode: AnalysisNode,
  ) {
    this.graph = this.buildGraph();
  }

  private buildGraph() {
    const builder = new StateGraph(AnalysisState)
      .addNode('input_router', (state: AnalysisStateType) =>
        this.inputRouterNode.execute(state),
      )
      .addNode('analysis', (state: AnalysisStateType) =>
        this.analysisNode.execute(state),
      )
      .addEdge(START, 'input_router')
      .addEdge('input_router', 'analysis')
      .addEdge('analysis', END);

    return builder.compile();
  }

  async execute(input: AnalysisWorkflowInput): Promise<AnalysisStateType> {
    const initialState: Partial<AnalysisStateType> = {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      phoneId: input.phoneId,
      clientId: input.clientId,
      isGroup: input.isGroup,
      messages: input.messages,
      processedMessages: [],
      warnings: [],
      totalCost: 0,
      realName: null,
      subConversations: [],
      products: [],
      promotions: [],
      existingIntents: input.existingIntents,
      isInternal: false,
      internalPurpose: null,
    };

    const result = await this.graph.invoke(initialState);

    this.logger.log(
      `AnalysisWorkflow completed: ${result.subConversations?.length ?? 0} sub-conversations, cost=$${result.totalCost?.toFixed(6)}`,
    );

    return result;
  }
}
