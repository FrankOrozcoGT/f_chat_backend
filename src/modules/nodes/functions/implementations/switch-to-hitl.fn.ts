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
    description: 'Transfiere la conversación a un agente humano cuando el cliente lo solicita.',
  })
  async execute(ctx: NodeContext): Promise<string> {
    await this.sessionLifecycle.switchToHitl({
      conversationId: ctx.conversationId,
      reason: 'client_request',
      userId: ctx.userId,
    });

    this.logger.log(
      `Switched to HITL for conversation ${ctx.conversationId}, reason: client_request`,
    );
    return 'hitl';
  }
}
