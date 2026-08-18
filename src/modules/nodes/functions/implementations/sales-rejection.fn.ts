import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class SalesRejectionFn {
  private readonly logger = new Logger(SalesRejectionFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'salesRejection',
    name: 'Registro de rechazo de venta',
    description:
      'El cliente rechaza la compra. Registra el rechazo y transfiere a HITL.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'salesRejection',
        description:
          'El cliente rechazó la compra. Registra motivo y transfiere a un humano.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Motivo del rechazo (precio alto, no le interesa, etc.).',
            },
            productName: {
              type: 'string',
              description: 'Producto que rechazó.',
            },
          },
          required: ['reason', 'productName'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const reason = ctx.args?.reason as string;
    const productName = ctx.args?.productName as string;

    if (!reason || !productName) {
      throw new Error('salesRejection: "reason" y "productName" son requeridos');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'salesRejection',
        args: { reason, productName },
      });
      this.logger.log(`salesRejection [TEST]: ${productName} — ${reason}`);
      return 'Rechazo registrado. Transferido a HITL.';
    }

    // Actualizar summary con el rechazo
    await this.internalApi.updateConversationSummary(
      ctx.conversationId,
      `Rechazo de venta: ${productName} — Motivo: ${reason}`,
    );

    await this.internalApi.updateConversationMode(ctx.conversationId, 'hitl');

    this.logger.log(`salesRejection: ${productName} — ${reason} → HITL`);

    return 'Rechazo registrado. Transferido a HITL.';
  }
}
