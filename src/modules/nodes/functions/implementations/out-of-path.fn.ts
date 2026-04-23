import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

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
            reason: {
              type: 'string',
              description: 'Qué quiere el cliente que no puedes manejar en este nodo',
            },
            summary: {
              type: 'string',
              description: 'Resumen del progreso actual: qué se logró y qué falta en este nodo',
            },
          },
          required: ['reason', 'summary'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const reason = ctx.args?.reason as string;
    const summary = ctx.args?.summary as string;

    // Guardar contexto en flowSummary para que el flow router lo use
    if (ctx.nodeSession) {
      const flowSummary = `${reason}${summary ? `\n${summary}` : ''}`;
      await ctx.sessionStore.updateCurrentNode(ctx.nodeSession.id, ctx.nodeSession.currentNodeId ?? null, undefined, undefined, flowSummary);
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'outOfPath',
        args: { reason, summary },
      });
    }

    this.logger.log(
      `outOfPath: reason="${reason}" summary="${summary?.substring(0, 80)}"${ctx.isTest ? ' [TEST]' : ''}`,
    );

    return 'out_of_path';
  }
}
