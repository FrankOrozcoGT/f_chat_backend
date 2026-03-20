import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class ExitFlowFn {
  private readonly logger = new Logger(ExitFlowFn.name);

  @NodeFunction({
    code: 'exitFlow',
    name: 'Salir del flujo actual',
    description: 'El cliente cambió de tema o pidió algo fuera del flujo actual.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'exitFlow',
        description: 'Salir del flujo actual porque el cliente cambió de tema.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Motivo de salida del flujo',
            },
            summary: {
              type: 'string',
              description:
                'Resumen del progreso: qué se logró y qué falta del flujo actual',
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

    if (ctx.nodeSession) {
      await ctx.sessionStore.pauseFlow(ctx.nodeSession.id, summary);
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'exitFlow',
        args: { reason, summary },
      });
    }

    this.logger.log(
      `exitFlow: reason="${reason}" summary="${summary?.substring(0, 80)}"${ctx.isTest ? ' [TEST]' : ''}`,
    );

    return 'flow_exited';
  }
}
