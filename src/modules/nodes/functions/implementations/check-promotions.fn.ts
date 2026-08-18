import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class CheckPromotionsFn {
  private readonly logger = new Logger(CheckPromotionsFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'checkPromotions',
    name: 'Verificar promociones',
    description: 'Verifica si hay promociones aplicables a un producto específico.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'checkPromotions',
        description:
          'Verifica promociones aplicables a un producto. Devuelve las promociones con precios especiales.',
        parameters: {
          type: 'object',
          properties: {
            productName: {
              type: 'string',
              description: 'Nombre exacto del producto a verificar.',
            },
          },
          required: ['productName'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const productName = ctx.args?.productName as string;
    if (!productName) {
      throw new Error('checkPromotions: "productName" es requerido pero no fue proporcionado');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'checkPromotions', args: { productName } });
      this.logger.log(`checkPromotions [TEST]: "${productName}"`);
      return `No hay promociones aplicables para "${productName}".`;
    }

    const conversation = await this.internalApi.getConversationFull(ctx.conversationId);
    const clientId = conversation.client?.id ?? null;

    const { promotions } = await this.internalApi.checkPromotions(
      ctx.tenantId,
      clientId,
      productName,
    );

    if (promotions.length === 0) {
      return `No hay promociones aplicables para "${productName}".`;
    }

    this.logger.log(`checkPromotions: "${productName}" → ${promotions.length} promos`);

    return promotions
      .map((p) => {
        let line = `- ${p.name ?? 'Promoción'}: Q${p.specialPrice}`;
        if (p.description) line += ` — ${p.description}`;
        return line;
      })
      .join('\n');
  }
}
