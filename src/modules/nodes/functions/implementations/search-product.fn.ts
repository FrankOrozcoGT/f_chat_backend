import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

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
      return `- Producto de prueba (${query}): Q85.00 — Producto de ejemplo para testing`;
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
