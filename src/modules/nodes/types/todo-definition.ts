import { Logger } from '@nestjs/common';

const logger = new Logger('TodoDefinition');

export interface TodoDefinition {
  id: string;
  name: string;
  description?: string;
  functions?: string[];
  transitions?: string[];
}

function isTodoDefinition(value: unknown): value is TodoDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string';
}

/**
 * Parsea el campo `todos` (JSON de Prisma, forma no garantizada en compile-time)
 * validando cada entrada en runtime. Acepta tanto el array ya parseado como un
 * string JSON serializado. Entradas inválidas se descartan y quedan logueadas
 * como warning para poder detectar corrupción de datos en producción.
 */
export function parseTodoDefinitions(raw: unknown): TodoDefinition[] {
  let candidate: unknown = raw;

  if (typeof candidate === 'string') {
    const rawString = candidate;
    try {
      candidate = JSON.parse(rawString);
    } catch {
      logger.warn(`todos no es JSON válido, se ignora: ${rawString.slice(0, 200)}`);
      return [];
    }
  }

  if (candidate === null || candidate === undefined) return [];

  if (!Array.isArray(candidate)) {
    logger.warn(`todos no es un array (tipo recibido: ${typeof candidate}), se ignora`);
    return [];
  }

  const result: TodoDefinition[] = [];
  for (const [i, entry] of candidate.entries()) {
    if (isTodoDefinition(entry)) {
      result.push(entry);
    } else {
      logger.warn(`todos[${i}] con forma inválida (falta id/name como string), se descarta: ${JSON.stringify(entry)}`);
    }
  }
  return result;
}
