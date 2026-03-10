import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { IntentRepository } from '../../repositories/intent.repository';
import { NodeRepository } from '../../repositories/node.repository';
import { NodeSessionRepository } from '../../repositories/node-session.repository';
import { SessionLifecycleService } from '../../../ai/services/session-lifecycle.service';

@Injectable()
export class FindFlowForIntentFn {
  private readonly logger = new Logger(FindFlowForIntentFn.name);

  constructor(
    private readonly intentRepo: IntentRepository,
    private readonly nodeRepo: NodeRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly sessionLifecycle: SessionLifecycleService,
  ) {}

  @NodeFunction({
    code: 'findFlowForIntent',
    name: 'Buscar flujo por intención',
    description:
      'Cuando detectas una intención del cliente. Incluye el nombre de la intención en datos.',
    outputSchema: {
      intent: {
        type: 'string',
        description: 'Detected intent name (snake_case)',
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const { userId, conversationId, nodeSession } = ctx;

    const intentName = ctx.toolCallArgs?.intent as string | undefined;

    if (!intentName) {
      throw new Error(
        `findFlowForIntent: "intent" is required — got: ${JSON.stringify(ctx.toolCallArgs)}`,
      );
    }

    // Reads are always OK (even in test)
    const intent = await this.intentRepo.findByUserIdAndName(
      userId,
      intentName,
    );

    if (!intent) {
      if (ctx.isTest) {
        ctx.sideEffects.push(
          { action: 'upsertIntent', args: { intentName } },
          { action: 'switchToHitl', args: { reason: 'unknown_intent', intentName } },
        );
        this.logger.warn(`FindFlowForIntent [TEST]: unknown intent "${intentName}" → HITL`);
        return 'hitl_unknown_intent';
      }
      await this.intentRepo.upsert(userId, intentName);
      this.logger.warn(
        `Unknown intent "${intentName}" — registered and switching to HITL`,
      );
      await this.sessionLifecycle.switchToHitl({
        conversationId,
        reason: 'client_request',
        userId,
        extras: { apiName: `node:unknown_intent:${intentName}` },
      });
      return 'hitl_unknown_intent';
    }

    if (!intent.flowId || !intent.flow) {
      if (ctx.isTest) {
        ctx.sideEffects.push({ action: 'switchToHitl', args: { reason: 'no_flow', intentName } });
        this.logger.warn(`FindFlowForIntent [TEST]: intent "${intentName}" has no flow → HITL`);
        return 'hitl_no_flow';
      }
      this.logger.warn(
        `Intent "${intentName}" has no flow assigned — switching to HITL`,
      );
      await this.sessionLifecycle.switchToHitl({
        conversationId,
        reason: 'client_request',
        userId,
        extras: { apiName: `node:no_flow:${intentName}` },
      });
      return 'hitl_no_flow';
    }

    const targetFlow = await this.nodeRepo.findFlowWithNodes(intent.flow.id);
    if (!targetFlow?.routerNode) {
      throw new Error(
        `Flow "${intent.flow.name}" (${intent.flow.id}) has no router node`,
      );
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'transitionToFlow',
        args: { flowId: targetFlow.id, flowName: targetFlow.name, nodeId: targetFlow.routerNode.id, intentName },
      });
      this.logger.log(`FindFlowForIntent [TEST]: → flow "${targetFlow.name}"`);
      return 'transitioned';
    }

    await this.nodeSessionRepo.updateCurrentNode(
      nodeSession.id,
      targetFlow.routerNode.id,
      intentName,
    );

    this.logger.log(
      `Transitioned to flow "${targetFlow.name}" node "${targetFlow.routerNode.name}"`,
    );
    return 'transitioned';
  }
}
