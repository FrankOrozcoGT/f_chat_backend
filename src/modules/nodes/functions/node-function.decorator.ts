import 'reflect-metadata';
import { ToolDefinition } from '../../ai/clients/kimi.client';

export const NODE_FUNCTION_METADATA = 'NODE_FUNCTION_METADATA';

export const NodeFunctionType = {
  TOOL: 'tool',
  PRE_CODE: 'preCode',
  POST_CODE: 'postCode',
} as const;

export type NodeFunctionType = typeof NodeFunctionType[keyof typeof NodeFunctionType];

export interface NodeFunctionMeta {
  /** Identificador único de la función. Debe ser único en todo el registry. */
  code: string;
  /** Nombre legible de la función. */
  name: string;
  /** Descripción para el LLM (qué hace, qué output genera). */
  description: string;
  /** Si es una tool invocable por el LLM, su definición OpenAI-compatible. */
  toolDefinition?: ToolDefinition;
  /**
   * Schema JSON para el campo "datos" cuando esta función se usa como postCode output.
   * Se inyecta en la tool "output" para que el LLM sepa qué datos enviar.
   */
  outputSchema?: Record<string, unknown>;
}

export function NodeFunction(meta: NodeFunctionMeta): MethodDecorator {
  return (target, propertyKey) => {
    const existing: (NodeFunctionMeta & { _method: string })[] =
      Reflect.getMetadata(NODE_FUNCTION_METADATA, target.constructor) || [];
    existing.push({ ...meta, _method: propertyKey as string });
    Reflect.defineMetadata(NODE_FUNCTION_METADATA, existing, target.constructor);
  };
}
