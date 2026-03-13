import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class ConfirmSaleFn {
  private readonly logger = new Logger(ConfirmSaleFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'confirmSale',
    name: 'Confirmar venta',
    description:
      'El cliente confirmó el total. Registra la venta y pasa al siguiente paso. NO envía mensaje al cliente.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'confirmSale',
        description:
          'El cliente confirmó el total final. Registra la venta. NO envía mensaje al cliente. Solo usar después de que el cliente confirmó el total mostrado por calculateSale.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description: 'Productos confirmados.',
              items: {
                type: 'object',
                properties: {
                  productName: { type: 'string' },
                  unitPrice: { type: 'number' },
                  quantity: { type: 'number' },
                },
                required: ['productName', 'unitPrice', 'quantity'],
              },
            },
            shippingCost: {
              type: 'number',
              description: 'Costo de envío calculado por calculateSale.',
            },
            total: {
              type: 'number',
              description: 'Total final confirmado por el cliente.',
            },
          },
          required: ['items', 'shippingCost', 'total'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const items = ctx.toolCallArgs?.items as Array<{
      productName: string;
      unitPrice: number;
      quantity: number;
    }>;
    const shippingCost = ctx.toolCallArgs?.shippingCost as number;
    const total = ctx.toolCallArgs?.total as number;

    if (!items) {
      throw new Error('confirmSale: "items" es requerido');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'confirmSale',
        args: { items, shippingCost, total },
      });
      this.logger.log(`confirmSale [TEST]: total Q${total}`);
      return `Venta confirmada. Total: Q${total}`;
    }

    // TODO: transicionar al nodo Facturación/Despacho cuando exista
    // Por ahora: HITL temporal
    await this.internalApi.updateConversationMode(ctx.conversationId, 'hitl');

    this.logger.log(`confirmSale: total Q${total} → HITL (temporal)`);

    return `Venta confirmada. Total: Q${total}.`;
  }
}
