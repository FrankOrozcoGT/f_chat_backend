import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { SessionLifecycleService } from '../../../ai/services/session-lifecycle.service';

@Injectable()
export class SwitchToHitlFn {
  private readonly logger = new Logger(SwitchToHitlFn.name);

  constructor(
    private readonly sessionLifecycle: SessionLifecycleService,
  ) {}

  @NodeFunction({
    code: 'switchToHitl',
    name: 'Transferir a humano',
    description: 'Transfiere la conversación a un agente humano.',
  })
  async execute(ctx: NodeContext): Promise<string> {
    const reason =
      ctx.llmResult?.terminationArgs?.tipo === 'error'
        ? 'api_error'
        : 'client_request';

    const message = ctx.llmResult?.terminationArgs?.datos
      ? (ctx.llmResult.terminationArgs.datos as any).message
      : undefined;

    await this.sessionLifecycle.switchToHitl({
      conversationId: ctx.conversationId,
      reason,
      userId: ctx.userId,
      extras: {
        apiName: `node:${ctx.node.name}`,
        errorMessage: message,
      },
    });

    this.logger.log(
      `Switched to HITL for conversation ${ctx.conversationId}, reason: ${reason}`,
    );
    return 'hitl';
  }
}
