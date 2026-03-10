import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, END, START } from '@langchain/langgraph';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { WorkflowState, WorkflowStateType } from './state.interface';
import { InputRouterNode } from './nodes/input-router.node';
import { LlmNode } from './nodes/llm.node';
import { OutputRouterNode } from './nodes/output-router.node';
import { FinalizeNode } from './nodes/finalize.node';
import { IncomingMessageEvent } from '../ai-agent.service';

@Injectable()
export class AiWorkflow {
  private readonly logger = new Logger(AiWorkflow.name);
  private graph: any;

  constructor(
    private readonly inputRouterNode: InputRouterNode,
    private readonly llmNode: LlmNode,
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
      .addNode('llm', (state: WorkflowStateType) => this.llmNode.execute(state))
      .addNode('output_router', (state: WorkflowStateType) =>
        this.outputRouterNode.execute(state),
      )
      .addNode('finalize', (state: WorkflowStateType) =>
        this.finalizeNode.execute(state),
      )
      .addEdge(START, 'input_router')
      .addEdge('input_router', 'llm')
      .addEdge('llm', 'output_router')
      .addEdge('output_router', 'finalize')
      .addEdge('finalize', END);

    return builder.compile();
  }

  async execute(payload: IncomingMessageEvent): Promise<void> {
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
      totalCost: 0,
      error: null,
    };

    await this.langSmithService.tracePipeline(
      async () => {
        const result = await this.graph.invoke(initialState);
        this.logger.log(
          `Workflow completed for ${payload.conversationId} | cost=$${result.totalCost?.toFixed(6)}`,
        );
        return result;
      },
      {
        conversationId: payload.conversationId,
        clientPhone: payload.clientPhone,
        mode: 'AI',
      },
    );
  }
}
