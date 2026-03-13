import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

const MOCK_PRODUCTS = [
  { name: 'Cartucho HP 664 Negro', price: 85, description: 'Cartucho de tinta original' },
  { name: 'Cartucho HP 664 Color', price: 95, description: 'Cartucho de tinta tricolor original' },
  { name: 'Tóner HP 26A', price: 350, description: 'Tóner negro original para LaserJet' },
  { name: 'Mouse Logitech M280', price: 95, description: 'Mouse inalámbrico' },
  { name: 'Teclado Logitech K120', price: 85, description: 'Teclado USB con cable' },
];

@Injectable()
export class SearchProductFn {
  private readonly logger = new Logger(SearchProductFn.name);

  constructor(private readonly internalApi: InternalApiClient) {}

  @NodeFunction({
    code: 'searchProduct',
    name: 'Buscar producto',
    description: 'Busca un producto específico en el catálogo por nombre o descripción.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'searchProduct',
        description:
          'Busca un producto en el catálogo por nombre o descripción. Devuelve coincidencias con precios.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Nombre o descripción del producto a buscar.',
            },
          },
          required: ['query'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const query = ctx.toolCallArgs?.query as string;
    if (!query) {
      throw new Error('searchProduct: "query" es requerido pero no fue proporcionado');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'searchProduct', args: { query } });
      this.logger.log(`searchProduct [TEST]: "${query}"`);
      const q = query.toLowerCase();
      const matches = MOCK_PRODUCTS.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      );
      if (matches.length === 0) {
        return `No se encontraron productos que coincidan con "${query}".`;
      }
      return matches.map((p) => `- ${p.name}: Q${p.price} — ${p.description}`).join('\n');
    }

    const { matches } = await this.internalApi.searchProduct(ctx.userId, query);

    if (matches.length === 0) {
      return `No se encontraron productos que coincidan con "${query}".`;
    }

    this.logger.log(`searchProduct: "${query}" → ${matches.length} resultados`);

    return matches
      .map((p) => {
        let line = `- ${p.name}: Q${p.basePrice}`;
        if (p.description) line += ` — ${p.description}`;
        return line;
      })
      .join('\n');
  }
}
