import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { EvolutionService } from '@common/evolution/evolution.service';
import { buildOutgoingMessageData } from '@common/utils/build-outgoing-message-data';
import { MessageType } from '@prisma/client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class ConfirmSaleFn {
  private readonly logger = new Logger(ConfirmSaleFn.name);

  constructor(
    private readonly internalApi: InternalApiClient,
    private readonly evolutionService: EvolutionService,
  ) {}

  @NodeFunction({
    code: 'confirmSale',
    name: 'Confirmar venta',
    description:
      'El cliente acepta la compra. Calcula total con envío y envía resumen al cliente. Precios ya incluyen IVA.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'confirmSale',
        description:
          'El cliente aceptó comprar. Calcula total (subtotal + envío) y envía resumen. Precios ya incluyen IVA.',
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
              description: 'Costo de envío (0 si Quetzaltenango ciudad).',
            },
            summary: {
              type: 'string',
              description: 'Resumen de la venta para enviar al cliente.',
            },
          },
          required: ['items', 'shippingCost', 'summary'],
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
    const summary = ctx.toolCallArgs?.summary as string;

    if (!items || !summary) {
      throw new Error('confirmSale: "items" y "summary" son requeridos');
    }

    const totals = await this.internalApi.confirmSale(items, shippingCost ?? 0);

    const message = `${summary}\n\nSubtotal: Q${totals.subtotal}\nEnvío: Q${totals.shippingCost}\n*Total: Q${totals.total}*`;

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'confirmSale',
        args: { items, totals, message },
      });
      this.logger.log(`confirmSale [TEST]: total Q${totals.total}`);
      return `Venta confirmada. Total: Q${totals.total}`;
    }

    // Enviar resumen al cliente
    const response = await this.evolutionService.sendTextMessage(
      ctx.instanceName,
      ctx.clientPhone,
      message,
    );

    const messageData = buildOutgoingMessageData(
      ctx.conversationId,
      MessageType.text,
      message,
      'pending',
      null,
      response.key.id,
      null,
      null,
      null,
      'bot',
    );

    await this.internalApi.sendMessageTransaction(
      ctx.conversationId,
      ctx.userId,
      messageData,
      {
        lastMessageAt: new Date(),
        lastMessagePreview: message.substring(0, 100),
      },
    );

    // Transferir a HITL (temporalmente, hasta que exista el nodo de facturación/despacho)
    await this.internalApi.updateConversationMode(ctx.conversationId, 'hitl');

    this.logger.log(`confirmSale: total Q${totals.total}, sent to ${ctx.clientPhone} → HITL`);

    return `Venta confirmada. Total: Q${totals.total}. Transferido a HITL para facturación/despacho.`;
  }
}
