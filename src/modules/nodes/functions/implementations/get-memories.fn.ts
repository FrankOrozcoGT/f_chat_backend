import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { TenantMemoryRepository } from '@modules/tenant-memory/repositories/tenant-memory.repository';

@Injectable()
export class GetMemoriesFn {
  private readonly logger = new Logger(GetMemoriesFn.name);

  constructor(private readonly tenantMemoryRepo: TenantMemoryRepository) {}

  @NodeFunction({
    code: 'getMemories',
    name: 'Obtener memorias del tenant',
    description: 'Recupera uno o varios valores almacenados en la memoria del tenant por sus claves.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'getMemories',
        description: 'Recupera valores almacenados en la memoria del tenant. Úsala cuando necesites datos específicos como información bancaria, horarios, métodos de pago, etc.',
        parameters: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Lista de claves a recuperar (ej: ["banking_info", "business_hours"])',
            },
          },
          required: ['keys'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    // preCode usa preCodeArgs, tool usa toolCallArgs
    const args = ctx.preCodeArgs ?? ctx.toolCallArgs;
    const keys = args?.keys as string[] | undefined;

    if (!keys || keys.length === 0) {
      throw new Error('getMemories: keys array is required and cannot be empty');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'getMemories', args: { keys } });
      this.logger.log(`getMemories [TEST]: keys=${keys.join(', ')}`);
      return JSON.stringify(Object.fromEntries(keys.map((k) => [k, `[mock value for "${k}"]`])));
    }

    const result = await this.tenantMemoryRepo.getKeys(ctx.tenantId, keys);

    const missing = keys.filter((k) => !(k in result));
    if (missing.length > 0) {
      this.logger.warn(`getMemories: keys not found for tenant=${ctx.tenantId}: ${missing.join(', ')}`);
    }

    this.logger.log(`getMemories: retrieved keys=[${Object.keys(result).join(', ')}] for tenant=${ctx.tenantId}`);
    return JSON.stringify(result);
  }
}
