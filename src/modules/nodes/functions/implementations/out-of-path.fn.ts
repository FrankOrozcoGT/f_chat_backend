import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { getStringArg } from '../args-validator';

@Injectable()
export class OutOfPathFn {
  private readonly logger = new Logger(OutOfPathFn.name);

  @NodeFunction({
    code: 'outOfPath',
    name: 'Fuera del camino del flujo',
    description: 'El cliente quiere algo que no es el happy path ni una transición conocida de este nodo.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'outOfPath',
        description: 'Llama esto cuando el cliente pide algo fuera del objetivo de este nodo. El sistema decidirá si redirigir a otro nodo del flujo, transferir a un humano, o salir del flujo.',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Qué quiere el cliente y resumen del progreso: qué se logró y qué falta en este nodo',
            },
          },
          required: ['summary'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const summary = getStringArg('outOfPath', ctx.args, 'summary', { required: true });

    // Guardar contexto en flowSummary para que el flow router lo use
    if (ctx.nodeSession) {
      await ctx.sessionStore.updateCurrentNode(ctx.nodeSession.id, ctx.nodeSession.currentNodeId ?? null, undefined, undefined, summary);
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'outOfPath',
        args: { summary },
      });
    }

    this.logger.log(
      `outOfPath: summary="${summary?.substring(0, 80)}"${ctx.isTest ? ' [TEST]' : ''}`,
    );

    return 'out_of_path';
  }
}
