import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

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
    description: 'Marca o desmarca todos del nodo actual. Retorna los pendientes para el happy path y los alternos disponibles.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'updateTodos',
        description:
          'Actualiza el estado de los todos del nodo. Puedes marcar varios a la vez (true=completado, false=pendiente). Retorna qué todos faltan para el happy path y qué transiciones alternas ya están disponibles.',
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
    const updates = ctx.args?.updates as Record<string, boolean> | undefined;
    if (!updates || typeof updates !== 'object') {
      throw new Error('updateTodos: "updates" es requerido y debe ser un objeto {todoId: boolean}');
    }

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
    (ctx.nodeSession as any).completedTodos = merged;

    this.logger.log(
      `updateTodos [${session.id}]: ${JSON.stringify(updates)} → completedTodos=${JSON.stringify(merged)}`,
    );

    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'updateTodos', args: { updates, result: merged } });
    }

    // Build response: what's missing for happy path + available alternates
    const nodeTodos: TodoDefinition[] = (ctx.node as any).todos ?? [];

    if (nodeTodos.length === 0) {
      return 'Todos actualizados. Este nodo no tiene todos definidos.';
    }

    const pendingForHappyPath = nodeTodos
      .filter((t) => !merged[t.id])
      .map((t) => `- ${t.name} (${t.id})`);

    // Check transitions from current node to find available alternates
    // Transitions with all requiredTodos met (excluding the happy path = last transition)
    const flow = ctx.flow as any;
    let availableAlternates: string[] = [];

    if (flow?.transitions) {
      const fromCurrentNode = flow.transitions.filter(
        (tr: any) => tr.fromNodeId === ctx.node.id,
      );

      availableAlternates = fromCurrentNode
        .filter((tr: any) => {
          const required: string[] = tr.requiredTodos ?? [];
          return required.length > 0 && required.every((id) => merged[id]);
        })
        .map((tr: any) => `- ${tr.transitionCode} (requiere: ${(tr.requiredTodos ?? []).join(', ')})`);
    }

    const lines: string[] = ['Todos actualizados.'];

    if (pendingForHappyPath.length === 0) {
      lines.push('Happy path COMPLETO — todas las tareas del nodo están listas.');
    } else {
      lines.push(`Pendientes para el happy path:\n${pendingForHappyPath.join('\n')}`);
    }

    if (availableAlternates.length > 0) {
      lines.push(`Transiciones alternas disponibles:\n${availableAlternates.join('\n')}`);
    }

    return lines.join('\n\n');
  }
}
