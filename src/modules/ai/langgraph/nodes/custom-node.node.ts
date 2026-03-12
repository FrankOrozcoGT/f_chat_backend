import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { NodeRunnerService } from '../../../nodes/services/node-runner.service';
import { NodeRepository } from '../../../nodes/repositories/node.repository';
import { NodeSessionRepository } from '../../../nodes/repositories/node-session.repository';
import { NodeContext } from '../../../nodes/functions/node-function.context';

@Injectable()
export class CustomNode {
  private readonly logger = new Logger(CustomNode.name);

  constructor(
    private readonly nodeRunner: NodeRunnerService,
    private readonly nodeRepo: NodeRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
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
      currentNodeId,
      flowId,
      nodeSessionId,
      apiCalls: existingApiCalls,
      totalCost: existingCost,
      error: previousError,
    } = state;

    if (previousError) return {};

    if (!currentNodeId) {
      throw new Error(
        `CustomNode: currentNodeId is null for conversation ${conversationId}. ` +
        `This node should only be reached when a flow has been activated.`,
      );
    }

    // Load node from DB
    const activeNode = await this.nodeRepo.findById(currentNodeId);
    if (!activeNode) {
      throw new Error(`CustomNode: node ${currentNodeId} not found`);
    }

    // Load history
    const messages = await this.internalApi.getMessageHistory(conversationId, 31);
    const previousMessages = messages.slice(0, -1);
    const history = previousMessages
      .filter((m) => m.content)
      .map((m) => ({
        role: m.direction === 'incoming' ? 'user' : 'assistant',
        content: m.content,
      }));

    this.logger.log(
      `CustomNode: executing node "${activeNode.name}" (${currentNodeId}) for conversation ${conversationId}`,
    );

    // Build NodeContext
    const ctx = new NodeContext();
    ctx.messageId = messageId;
    ctx.userId = userId;
    ctx.conversationId = conversationId;
    ctx.transcription = transcription;
    ctx.history = history;
    ctx.instanceName = instanceName;
    ctx.clientPhone = clientPhone;
    ctx.node = activeNode;
    ctx.isTest = state.isTest ?? false;

    // Load flow and nodeSession
    if (flowId) {
      ctx.flow = await this.nodeRepo.findFlowWithNodes(flowId) as any;
    }
    if (nodeSessionId) {
      const session = await this.nodeSessionRepo.findById(nodeSessionId);
      if (session) ctx.nodeSession = session;
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
      await this.internalApi.incrementCreditsUsed(userId, actualCredits);
      this.logger.log(
        `CustomNode: incremented ${actualCredits.toFixed(3)} credits (${result.tokensInput}in+${result.tokensOutput}out)`,
      );

      const preferredFormat: 'audio' | 'text' =
        messageType === MessageType.voice || messageType === MessageType.audio
          ? 'audio'
          : 'text';

      this.logger.log(
        `CustomNode: intent=${result.intent}, format=${preferredFormat}, response="${result.response.substring(0, 80)}"`,
      );

      return {
        responseText: result.response,
        intent: result.intent,
        preferredFormat,
        sideEffects: ctx.sideEffects,
        apiCalls: [...existingApiCalls, apiCall],
        totalCost: existingCost + result.costUsd,
      };
    } catch (error) {
      this.logger.error(`CustomNode: failed: ${error.message}`);
      return {
        error: { step: 'custom_node', apiName: 'kimi_llm', message: error.message },
      };
    }
  }
}
