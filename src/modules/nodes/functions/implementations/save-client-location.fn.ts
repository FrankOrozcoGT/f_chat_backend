import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { getStringArg } from '../args-validator';

@Injectable()
export class SaveClientLocationFn {
  private readonly logger = new Logger(SaveClientLocationFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'saveClientLocation',
    name: 'Guardar ubicación del cliente',
    description: 'Guarda o actualiza la ubicación del cliente para calcular envío.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'saveClientLocation',
        description:
          'Guarda la ubicación default del cliente.',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'Ubicación normalizada del cliente (ej: "Quetzaltenango ciudad", "Guatemala ciudad").',
            },
          },
          required: ['location'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const location = getStringArg('saveClientLocation', ctx.args, 'location', { required: true });

    const conversation = await this.internalApi.getConversationFull(ctx.conversationId);
    const clientId = conversation.client?.id;

    if (!clientId) {
      throw new Error('saveClientLocation: no se encontró cliente asociado a la conversación');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'saveClientLocation', args: { clientId, location } });
      this.logger.log(`saveClientLocation [TEST]: ${location} para cliente ${clientId}`);
      return `Ubicación "${location}" guardada para el cliente.`;
    }

    await this.internalApi.saveClientLocation(clientId, location);

    this.logger.log(`saveClientLocation: ${location} → cliente ${clientId}`);

    return `Ubicación "${location}" guardada para el cliente.`;
  }
}
