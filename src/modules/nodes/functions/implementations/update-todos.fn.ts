import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { getObjectArg } from '../args-validator';

export interface TodoDefinition {
  id: string;
  name: string;
  description?: string;
  functions?: string[];
  transitions?: string[];
}

@Injectable()
export class UpdateTodosFn {
  private readonly logger = new Logger(UpdateTodosFn.name);

  @NodeFunction({
    code: 'updateTodos',
    name: 'Actualizar todos',
    description: 'Marca o desmarca requisitos del nodo actual. Retorna los requisitos pendientes y las transiciones disponibles.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'updateTodos',
        description:
          'Actualiza el estado de los requisitos del nodo. Puedes marcar varios a la vez (true=completado, false=pendiente). Retorna qué requisitos faltan para continuar y qué transiciones alternas ya están disponibles.',
        parameters: {
          type: 'object',
          properties: {
            updates: {
              type: 'object',
              description: 'Mapa de id_del_todo → true/false. Ejemplo: {"identificar_producto": true, "dar_precio": false}',
              additionalProperties: { type: 'boolean' },
            },
          },
          required: ['updates'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const updates = getObjectArg<Record<string, boolean>>('updateTodos', ctx.args, 'updates', { required: true });

    const session = ctx.nodeSession;
    if (!session) {
      throw new Error('updateTodos: no hay sesión activa');
    }

    // Merge updates into existing completedTodos
    const existing = (session.completedTodos as Record<string, boolean> | null) ?? {};
    const merged: Record<string, boolean> = { ...existing, ...updates };

    // Persist
    const updated = await ctx.sessionStore.updateCompletedTodos(session.id, merged);
    // Update in-memory so subsequent calls in the same turn see fresh state
    ctx.nodeSession.completedTodos = merged;

    this.logger.log(
      `updateTodos [${session.id}]: ${JSON.stringify(updates)} → completedTodos=${JSON.stringify(merged)}`,
    );

    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'updateTodos', args: { updates, result: merged } });
    }

    // Build response: what's missing for happy path + available alternates
    const rawTodos = ctx.node.todos;
    const nodeTodos: TodoDefinition[] = Array.isArray(rawTodos) ? (rawTodos as unknown as TodoDefinition[]) : [];

    if (nodeTodos.length === 0) {
      return 'Todos actualizados. Este nodo no tiene todos definidos.';
    }

    const pendingForHappyPath = nodeTodos
      .filter((t) => !merged[t.id])
      .map((t) => `- ${t.name} (${t.id})`);

    // Check transitions from current node to find available alternates
    // Transitions with all requiredTodos met (excluding the happy path = last transition)
    // ctx.flow puede venir plano (sin `transitions`) cuando la sesión está cacheada
    const flow = ctx.flow;
    let availableAlternates: string[] = [];

    if (flow && 'transitions' in flow) {
      const fromCurrentNode = flow.transitions.filter(
        (tr) => tr.fromNodeId === ctx.node.id,
      );

      availableAlternates = fromCurrentNode
        .filter((tr) => {
          const required = (tr.requiredTodos as string[] | null) ?? [];
          return required.length > 0 && required.every((id) => merged[id]);
        })
        .map((tr) => `- ${tr.transitionCode} (requiere: ${((tr.requiredTodos as string[] | null) ?? []).join(', ')})`);
    }

    const lines: string[] = ['Todos actualizados.'];

    if (pendingForHappyPath.length === 0) {
      lines.push('Todos los requisitos completados — el nodo puede continuar.');
    } else {
      lines.push(`Requisitos pendientes:\n${pendingForHappyPath.join('\n')}`);
    }

    if (availableAlternates.length > 0) {
      lines.push(`Transiciones alternas disponibles:\n${availableAlternates.join('\n')}`);
    }

    return lines.join('\n\n');
  }
}
