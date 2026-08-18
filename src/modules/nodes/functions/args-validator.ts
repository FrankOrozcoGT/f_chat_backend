/**
 * Valida en runtime los args que el LLM manda a un tool call, verificando
 * tipo real (no solo presencia) contra lo que el toolDefinition promete
 * vía JSON-schema. Lanza Error con mensaje claro para el LLM (se retorna
 * como resultado de la tool call, no rompe el flujo).
 */

function fail(fnCode: string, field: string, expected: string, args: Record<string, unknown> | undefined): never {
  throw new Error(
    `${fnCode}: "${field}" debe ser ${expected} — recibido: ${JSON.stringify(args?.[field])}`,
  );
}

export function getStringArg(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options: { required: true },
): string;
export function getStringArg(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options?: { required?: false },
): string | undefined;
export function getStringArg(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options: { required?: boolean } = {},
): string | undefined {
  const value = args?.[field];
  if (value === undefined || value === null) {
    if (options.required) fail(fnCode, field, 'un string', args);
    return undefined;
  }
  if (typeof value !== 'string') fail(fnCode, field, 'un string', args);
  return value;
}

export function getNumberArg(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options: { required: true },
): number;
export function getNumberArg(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options?: { required?: false },
): number | undefined;
export function getNumberArg(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options: { required?: boolean } = {},
): number | undefined {
  const value = args?.[field];
  if (value === undefined || value === null) {
    if (options.required) fail(fnCode, field, 'un número', args);
    return undefined;
  }
  if (typeof value !== 'number') fail(fnCode, field, 'un número', args);
  return value;
}

export function getObjectArg<T extends Record<string, unknown>>(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options: { required: true },
): T;
export function getObjectArg<T extends Record<string, unknown>>(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options?: { required?: false },
): T | undefined;
export function getObjectArg<T extends Record<string, unknown>>(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options: { required?: boolean } = {},
): T | undefined {
  const value = args?.[field];
  if (value === undefined || value === null) {
    if (options.required) fail(fnCode, field, 'un objeto', args);
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) fail(fnCode, field, 'un objeto', args);
  return value as T;
}

export function getArrayArg<T = unknown>(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options: { required: true },
): T[];
export function getArrayArg<T = unknown>(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options?: { required?: false },
): T[] | undefined;
export function getArrayArg<T = unknown>(
  fnCode: string,
  args: Record<string, unknown> | undefined,
  field: string,
  options: { required?: boolean } = {},
): T[] | undefined {
  const value = args?.[field];
  if (value === undefined || value === null) {
    if (options.required) fail(fnCode, field, 'un array', args);
    return undefined;
  }
  if (!Array.isArray(value)) fail(fnCode, field, 'un array', args);
  return value as T[];
}
