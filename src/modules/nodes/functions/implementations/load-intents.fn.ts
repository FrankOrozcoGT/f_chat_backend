import { Injectable } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { IntentRepository } from '../../repositories/intent.repository';

@Injectable()
export class LoadIntentsFn {
  constructor(private readonly intentRepo: IntentRepository) {}

  @NodeFunction({
    code: 'loadIntents',
    name: 'Cargar intenciones',
    description:
      'Lista de intenciones conocidas para este usuario. Usa estos nombres exactos al detectar la intención del cliente.',
  })
  async execute(ctx: NodeContext): Promise<string> {
    const intents = await this.intentRepo.findByTenantId(ctx.tenantId);

    if (intents.length === 0) {
      return 'No hay intenciones configuradas.';
    }

    return intents
      .map((i) => {
        const hasFlow = i.flow ? ` → flujo "${i.flow.name}"` : ' → sin flujo asignado';
        return `- ${i.name}${hasFlow}`;
      })
      .join('\n');
  }
}
