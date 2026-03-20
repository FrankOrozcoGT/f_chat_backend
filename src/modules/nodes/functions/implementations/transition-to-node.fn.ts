import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { NodeRepository } from '../../repositories/node.repository';
import { SessionLifecycleService } from '../../../ai/services/session-lifecycle.service';

@Injectable()
export class TransitionToNodeFn {
  private readonly logger = new Logger(TransitionToNodeFn.name);

  constructor(
    private readonly nodeRepo: NodeRepository,
    private readonly sessionLifecycle: SessionLifecycleService,
  ) {}

  @NodeFunction({
    code: 'transitionToNode',
    name: 'Transicionar a otro nodo',
    description:
      'Transiciona al siguiente nodo del flujo. Usa el código de transición configurado. NO envía mensaje al cliente.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'transitionToNode',
        description:
          'Transiciona al siguiente nodo del flujo usando el código de transición configurado. NO envía mensaje al cliente — el siguiente nodo responderá.',
        parameters: {
          type: 'object',
          properties: {
            transitionCode: {
              type: 'string',
              description: 'Código de la transición configurada (ej: "venta_confirmada")',
            },
            summary: {
              type: 'string',
              description: 'Resumen breve del progreso hasta ahora para que el siguiente nodo tenga contexto (ej: "Cliente pidió 3 cajas de leche, total Q110, envío a Guatemala ciudad")',
            },
          },
          required: ['transitionCode', 'summary'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const transitionCode = ctx.args?.transitionCode as string;
    const summary = ctx.args?.summary as string | undefined;

    if (!transitionCode) {
      throw new Error('transitionToNode: "transitionCode" es requerido');
    }

    const flowId = ctx.nodeSession?.flowId;
    const currentNodeId = ctx.nodeSession?.currentNodeId;

    if (!flowId) {
      throw new Error(
        `transitionToNode: no hay flowId en la sesión. conversationId=${ctx.conversationId}`,
      );
    }
    if (!currentNodeId) {
      throw new Error(
        `transitionToNode: no hay currentNodeId en la sesión. conversationId=${ctx.conversationId}`,
      );
    }

    // Buscar la transición en DB (tanto test como prod necesitan validarla)
    const transition = await this.nodeRepo.findTransition(
      flowId,
      currentNodeId,
      transitionCode,
    );

    if (!transition) {
      if (ctx.isTest) {
        ctx.sideEffects.push({
          action: 'switchToHitl',
          args: { reason: 'invalid_transition', transitionCode, fromNodeId: currentNodeId },
        });
        this.logger.error(`transitionToNode [TEST]: transición "${transitionCode}" no encontrada`);
        return 'hitl_invalid_transition';
      }
      this.logger.error(
        `transitionToNode: transición "${transitionCode}" no encontrada para flow=${flowId} from=${currentNodeId}`,
      );
      await this.sessionLifecycle.switchToHitl({
        conversationId: ctx.conversationId,
        reason: 'api_error',
        tenantId: ctx.tenantId,
        extras: {
          apiName: 'node:invalid_transition',
          errorMessage: `Transición "${transitionCode}" no configurada desde nodo ${currentNodeId}`,
        },
      });
      return 'hitl_invalid_transition';
    }

    if (transition.fromNodeId !== currentNodeId) {
      if (ctx.isTest) {
        ctx.sideEffects.push({
          action: 'switchToHitl',
          args: { reason: 'wrong_transition_origin', transitionCode, fromNodeId: currentNodeId },
        });
        this.logger.error(`transitionToNode [TEST]: transición "${transitionCode}" es de ${transition.fromNodeId}, no de ${currentNodeId}`);
        return 'hitl_wrong_transition_origin';
      }
      this.logger.error(
        `transitionToNode: transición "${transitionCode}" es de ${transition.fromNodeId}, no de ${currentNodeId}`,
      );
      await this.sessionLifecycle.switchToHitl({
        conversationId: ctx.conversationId,
        reason: 'api_error',
        tenantId: ctx.tenantId,
        extras: {
          apiName: 'node:wrong_transition_origin',
          errorMessage: `Transición "${transitionCode}" no pertenece al nodo actual ${currentNodeId}`,
        },
      });
      return 'hitl_wrong_transition_origin';
    }

    // Actualizar currentNodeId en la sesión al nodo destino + guardar resumen (test y prod)
    await ctx.sessionStore.updateCurrentNode(
      ctx.nodeSession.id,
      transition.toNodeId,
      undefined,
      undefined,
      summary ?? undefined,
    );

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'transitionToNode',
        args: { transitionCode, fromNodeId: currentNodeId, toNodeId: transition.toNodeId, flowId },
      });
    }

    this.logger.log(
      `transitionToNode: ${currentNodeId} → ${transition.toNodeId} via "${transitionCode}"${ctx.isTest ? ' [TEST]' : ''}`,
    );

    return `transitioned:${transition.toNodeId}`;
  }
}
