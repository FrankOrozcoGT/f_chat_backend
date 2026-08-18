import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
@Injectable()
export class MoveToLastConversationFn {
  private readonly logger = new Logger(MoveToLastConversationFn.name);

  constructor(
    private readonly internalApi: InternalApiClient,
  ) {}

  @NodeFunction({
    code: 'moveToLastConversation',
    name: 'Mover mensaje a conversacion anterior',
    description:
      'Usa esta funcion SOLO cuando NO hay historial previo en la conversacion y el mensaje del cliente es cortesia post-despedida (ej: "gracias", "ok") sin intencion nueva. Esto significa que la conversacion anterior ya fue cerrada y este mensaje llego despues. Mueve el mensaje al historial de la conversacion anterior.',
  })
  async execute(ctx: NodeContext): Promise<string> {
    if (ctx.isTest) {
      ctx.sideEffects.push(
        { action: 'moveToLastConversation', args: { messageId: ctx.messageId } },
        { action: 'closeNodeSession', args: { nodeSessionId: ctx.nodeSession.id } },
      );
      await ctx.sessionStore.close(ctx.nodeSession.id);
      this.logger.log(`MoveToLastConversation [TEST]: skipped`);
      return 'moved_to_last_conversation';
    }

    await this.internalApi.moveMessagesToConversation([ctx.messageId]);

    this.logger.log(
      `Moved message ${ctx.messageId} to last conversation for ${ctx.clientPhone}`,
    );

    await ctx.sessionStore.close(ctx.nodeSession.id);

    return 'moved_to_last_conversation';
  }
}
