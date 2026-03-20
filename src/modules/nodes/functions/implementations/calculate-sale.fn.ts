import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class CalculateSaleFn {
  private readonly logger = new Logger(CalculateSaleFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'calculateSale',
    name: 'Calcular venta',
    description:
      'Calcula subtotal, costo de envío y total de la venta. Se puede llamar múltiples veces conforme el cliente modifica el pedido.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'calculateSale',
        description:
          'Calcula subtotal, envío y total. Llámala cada vez que cambie el pedido (agregar, quitar, cambiar cantidad). Muestra el resultado al cliente con "responder".',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description: 'Productos del pedido actual.',
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
            location: {
              type: 'string',
              description: 'Ubicación del cliente (ciudad normalizada, ej: "Quetzaltenango ciudad").',
            },
          },
          required: ['items', 'location'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const items = ctx.args?.items as Array<{
      productName: string;
      unitPrice: number;
      quantity: number;
    }>;
    const location = ctx.args?.location as string;

    if (!items || items.length === 0) {
      throw new Error('calculateSale: "items" es requerido y no puede estar vacío');
    }
    if (!location) {
      throw new Error('calculateSale: "location" es requerido');
    }

    if (ctx.isTest) {
      const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
      const shippingCost = location.toLowerCase().includes('quetzaltenango') ? 0 : 25;
      const total = subtotal + shippingCost;
      ctx.sideEffects.push({ action: 'calculateSale', args: { items, location, subtotal, shippingCost, total } });
      this.logger.log(`calculateSale [TEST]: subtotal=Q${subtotal}, envío=Q${shippingCost}, total=Q${total}`);
      return `Subtotal: Q${subtotal.toFixed(2)}, Envío a ${location}: Q${shippingCost.toFixed(2)}, Total: Q${total.toFixed(2)}`;
    }

    const result = await this.internalApi.calculateSale(ctx.tenantId, items, location);

    this.logger.log(
      `calculateSale: ${items.length} items, ${location} → subtotal=Q${result.subtotal}, envío=Q${result.shippingCost}, total=Q${result.total}`,
    );

    return `Subtotal: Q${result.subtotal.toFixed(2)}, Envío a ${location}: Q${result.shippingCost.toFixed(2)}, Total: Q${result.total.toFixed(2)}`;
  }
}
