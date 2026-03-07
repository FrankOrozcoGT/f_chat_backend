import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { NodeSessionRepository } from '../../repositories/node-session.repository';

@Injectable()
export class CloseSessionFn {
  private readonly logger = new Logger(CloseSessionFn.name);

  constructor(
    private readonly nodeSessionRepo: NodeSessionRepository,
  ) {}

  @NodeFunction({
    code: 'closeSession',
    name: 'Cerrar sesión',
    description: 'Cierra la sesión de nodo actual.',
  })
  async execute(ctx: NodeContext): Promise<string> {
    await this.nodeSessionRepo.close(ctx.nodeSession.id);
    this.logger.log(
      `Closed node session ${ctx.nodeSession.id} for conversation ${ctx.conversationId}`,
    );
    return 'closed';
  }
}
