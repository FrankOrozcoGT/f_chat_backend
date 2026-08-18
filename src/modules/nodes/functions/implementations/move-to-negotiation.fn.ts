import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class MoveToNegotiationFn {
  private readonly logger = new Logger(MoveToNegotiationFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'moveToNegotiation',
    name: 'Mover a negociación',
    description:
      'El cliente quiere negociar el precio. Transfiere a control humano (HITL).',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'moveToNegotiation',
        description:
          'El cliente quiere negociar precio. Transfiere la conversación a un humano.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Razón de la negociación (qué producto, qué pide el cliente).',
            },
          },
          required: ['reason'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const reason = ctx.args?.reason as string;
    if (!reason) {
      throw new Error('moveToNegotiation: "reason" es requerido');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'moveToNegotiation',
        args: { reason },
      });
      this.logger.log(`moveToNegotiation [TEST]: ${reason}`);
      return 'Transferido a negociación (HITL).';
    }

    await this.internalApi.updateConversationMode(ctx.conversationId, 'hitl');

    this.logger.log(`moveToNegotiation: ${reason} → HITL`);

    return 'Transferido a negociación (HITL).';
  }
}
