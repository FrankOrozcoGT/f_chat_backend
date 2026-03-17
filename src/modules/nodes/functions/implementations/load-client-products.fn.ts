import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class LoadClientProductsFn {
  private readonly logger = new Logger(LoadClientProductsFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'loadClientProducts',
    name: 'Cargar productos del cliente',
    description:
      'Carga el catálogo de productos del usuario con descuentos personalizados del cliente y promociones aplicables.',
  })
  async execute(ctx: NodeContext): Promise<string> {
    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'loadClientProducts' });
      this.logger.log('loadClientProducts [TEST]: returning mock catalog');
      return `
--- CATÁLOGO DE PRODUCTOS ---
- Cartucho HP 664 Negro: Q85.00 — Cartucho de tinta original
- Cartucho HP 664 Color: Q95.00 — Cartucho de tinta tricolor original
- Tóner HP 26A: Q350.00 — Tóner negro original para LaserJet

--- PROMOCIONES ---
- 2x1 en cartuchos HP 664: Q150.00 (Cartucho HP 664 Negro, Cartucho HP 664 Color) — Lleva negro y color por Q150

--- ENVÍO ---
Ubicación default del cliente: Guatemala ciudad`;
    }

    // Obtener clientId desde la conversación
    const conversation = await this.internalApi.getConversationFull(
      ctx.conversationId,
    );
    const clientId = conversation.client?.id ?? null;

    const { products, promotions, shipping } = await this.internalApi.loadClientProducts(
      ctx.tenantId,
      clientId,
    );

    if (products.length === 0) {
      return 'No hay productos en el catálogo.';
    }

    let result = '\n--- CATÁLOGO DE PRODUCTOS ---\n';
    for (const p of products) {
      const discount = p.discounts.find((d) => d.clientId === clientId);
      const price = discount ? discount.discountPrice : p.basePrice;
      const priceNote = discount
        ? ` (precio especial para este cliente, base: Q${p.basePrice})`
        : '';
      result += `- ${p.name}: Q${price}${priceNote}`;
      if (p.description) result += ` — ${p.description}`;
      result += '\n';
    }

    if (promotions.length > 0) {
      result += '\n--- PROMOCIONES ---\n';
      for (const promo of promotions) {
        const promoProducts = promo.promotionProducts
          .map((pp) => pp.product.name)
          .join(', ');
        result += `- ${promo.name ?? 'Promoción'}: Q${promo.specialPrice} (${promoProducts})`;
        if (promo.description) result += ` — ${promo.description}`;
        result += '\n';
      }
    }

    // Envío: solo la ubicación del cliente si existe (zonas se obtienen vía calculateSale)
    if (shipping.clientLocation) {
      result += '\n--- ENVÍO ---\n';
      result += `Ubicación default del cliente: ${shipping.clientLocation}\n`;
    }

    this.logger.log(
      `loadClientProducts: ${products.length} productos, ${promotions.length} promos, clientLocation: ${shipping.clientLocation} (clientId: ${clientId})`,
    );

    return result;
  }
}
