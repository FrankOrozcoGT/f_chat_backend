import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { getStringArg, getNumberArg } from '../args-validator';

@Injectable()
export class SaveProductPriceFn {
  private readonly logger = new Logger(SaveProductPriceFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'saveProductPrice',
    name: 'Guardar producto con precio',
    description:
      'Guarda o actualiza un producto en el catálogo con su precio. Usar cuando el supervisor confirma precio de un producto.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'saveProductPrice',
        description:
          'Guarda o actualiza un producto en el catálogo con su precio.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Nombre del producto.',
            },
            price: {
              type: 'number',
              description: 'Precio del producto (sin IVA o precio base).',
            },
            description: {
              type: 'string',
              description: 'Descripción breve del producto (opcional).',
            },
          },
          required: ['name', 'price'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const name = getStringArg('saveProductPrice', ctx.args, 'name', { required: true });
    const price = getNumberArg('saveProductPrice', ctx.args, 'price', { required: true });
    const description = getStringArg('saveProductPrice', ctx.args, 'description');

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'saveProductPrice',
        args: { name, price, description },
      });
      this.logger.log(`saveProductPrice [TEST]: ${name} → Q${price}`);
      return `Producto "${name}" guardado con precio Q${price}.`;
    }

    const product = await this.internalApi.upsertProduct({
      tenantId: ctx.tenantId,
      name,
      basePrice: price,
      description,
    });

    this.logger.log(`saveProductPrice: "${name}" → Q${price} (id=${product.id})`);

    return `Producto "${name}" guardado con precio Q${price}.`;
  }
}
