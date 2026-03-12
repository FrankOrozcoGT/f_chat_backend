import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class CalculateShippingFn {
  private readonly logger = new Logger(CalculateShippingFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'calculateShipping',
    name: 'Calcular envío',
    description: 'Calcula el costo de envío según la ubicación del cliente.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'calculateShipping',
        description:
          'Calcula el costo de envío según la ubicación. Consulta las zonas de envío configuradas por el vendedor.',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'Ubicación del cliente (ciudad normalizada, ej: "Quetzaltenango ciudad").',
            },
          },
          required: ['location'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const location = ctx.toolCallArgs?.location as string;
    if (!location) {
      throw new Error('calculateShipping: "location" es requerido pero no fue proporcionado');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'calculateShipping', args: { location } });
      this.logger.log(`calculateShipping [TEST]: "${location}"`);
      return `Envío a ${location}: Q25.00.`;
    }

    const result = await this.internalApi.calculateShipping(ctx.userId, location);

    let message: string;
    if (result.isFreeShipping) {
      message = `Envío a ${location}: GRATIS.`;
    } else {
      message = `Envío a ${location}: Q${result.shippingCost}.`;
    }

    this.logger.log(`calculateShipping: "${location}" → Q${result.shippingCost} (${result.source})`);

    return message;
  }
}
