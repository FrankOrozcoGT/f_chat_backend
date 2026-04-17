import { Injectable, Logger } from '@nestjs/common';
import { ParsedDiagram, ParsedEdge, ParsedStep, ParsedSubgraph } from './types';

// Parser tokenizado de diagramas Mermaid flowchart.
//
// SI ALGO FALLA, revisar:
// 1. `isIgnorable(line)` — líneas que la IA a veces mete y no son parte del grafo
//    (comentarios `%` y `%%`, `style`, `classDef`, `direction`, etc.)
// 2. `parseSubgraphOpen(line)` — soporta `subgraph ID`, `subgraph ID[name]`,
//    `subgraph ID["name"]`. Si la IA usa otra sintaxis, no la detectará.
// 3. `tokenizeLine(line)` — reconoce nodos y arrows línea por línea. Maneja
//    cadenas `A --> B --> C` y declaraciones inline `A --> B[label]`.
// 4. `matchArrow()` — solo soporta `-->`, `-.->`, `==>`. Añadir otros si la IA los usa.
// 5. `matchNode()` — formas soportadas de nodos: `X[l]`, `X(l)`, `X((l))`, `X{l}`,
//    `X{{l}}`, `X[[l]]`, `X[(l)]`, `X>l]`, `X/l/`. Si la IA usa otra forma, añadir al map.
// 6. Nodos placeholder fuera de subgraphs (ej: `I1[Internal X]` usados para representar
//    internals en aristas `-.->`) quedan como `unresolved` — es correcto.
//
// Errores comunes y cómo diagnosticarlos (reportados por `errors[]` y `unresolvedEdges[]`):
// - "línea no parseable" → la IA metió sintaxis que este parser no conoce.
// - "tokens mal ordenados" → la línea tiene algo tipo `X Y --> Z` (nodos sueltos entre arrows).
// - unresolvedEdges con stepId tipo `I1` / `I2` → aristas a placeholders de internals, se ignoran.

interface Token {
  type: 'node' | 'arrow';
  id?: string;
  label?: string;
  arrow?: '-->' | '-.->';
  edgeLabel?: string;
}

@Injectable()
export class MermaidParser {
  private readonly logger = new Logger(MermaidParser.name);

  parse(mermaid: string): ParsedDiagram {
    const lines = mermaid.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    const subgraphsById = new Map<string, ParsedSubgraph>();
    const subgraphOrder: string[] = [];
    const edges: ParsedEdge[] = [];
    const stepToSubgraph = new Map<string, string>();
    const subgraphStack: string[] = [];

    for (const rawLine of lines) {
      const line = this.stripTrailingComment(rawLine);
      if (!line) continue;

      if (this.isIgnorable(line)) continue;

      if (line === 'end') {
        if (subgraphStack.length === 0) {
          throw new Error(`MermaidParser: unexpected 'end' without open subgraph`);
        }
        subgraphStack.pop();
        continue;
      }

      const sg = this.parseSubgraphOpen(line);
      if (sg) {
        if (!subgraphsById.has(sg.id)) {
          subgraphsById.set(sg.id, { id: sg.id, name: sg.name, steps: [] });
          subgraphOrder.push(sg.id);
        }
        subgraphStack.push(sg.id);
        continue;
      }

      // Aristas y nodos: tokenizar
      const tokens = this.tokenizeLine(line);
      if (tokens.length === 0) continue;

      const currentSubgraph = subgraphStack[subgraphStack.length - 1];

      // Si es un solo nodo, es declaración
      if (tokens.length === 1 && tokens[0].type === 'node') {
        const t = tokens[0];
        if (!t.id) continue;
        if (currentSubgraph) {
          this.addStepToSubgraph(subgraphsById.get(currentSubgraph)!, t.id, t.label);
          if (!stepToSubgraph.has(t.id)) stepToSubgraph.set(t.id, currentSubgraph);
        }
        continue;
      }

      // Serie de node-arrow-node-arrow-node... → aristas en cadena
      for (let i = 0; i + 2 < tokens.length; i += 2) {
        const from = tokens[i];
        const arrow = tokens[i + 1];
        const to = tokens[i + 2];
        if (from.type !== 'node' || arrow.type !== 'arrow' || to.type !== 'node') continue;
        if (!from.id || !to.id) continue;

        // Registrar nodos inline en el subgraph actual si tienen label y no están registrados
        if (from.label && currentSubgraph && !stepToSubgraph.has(from.id)) {
          this.addStepToSubgraph(subgraphsById.get(currentSubgraph)!, from.id, from.label);
          stepToSubgraph.set(from.id, currentSubgraph);
        }
        if (to.label && currentSubgraph && !stepToSubgraph.has(to.id)) {
          this.addStepToSubgraph(subgraphsById.get(currentSubgraph)!, to.id, to.label);
          stepToSubgraph.set(to.id, currentSubgraph);
        }

        edges.push({
          fromStep: from.id,
          toStep: to.id,
          fromSubgraph: '',
          toSubgraph: '',
          label: arrow.edgeLabel ?? null,
          isInternal: arrow.arrow === '-.->',
        });
      }
    }

    // Detectar subgraphs de internals
    const allSubgraphs = subgraphOrder.map((id) => subgraphsById.get(id)!);
    const internalSubgraphIds = new Set<string>();
    for (const sg of allSubgraphs) {
      const nameLower = sg.name.trim().toLowerCase();
      const idLower = sg.id.toLowerCase();
      const looksInternalByName =
        nameLower.startsWith('internal') ||
        nameLower.startsWith('interno') ||
        idLower.startsWith('internal') ||
        idLower.startsWith('interno');
      const allStepsAreI = sg.steps.length > 0 && sg.steps.every((s) => /^I[0-9]+$/.test(s.id));
      if (looksInternalByName || allStepsAreI) {
        internalSubgraphIds.add(sg.id);
      }
    }

    const flowSubgraphs = allSubgraphs.filter((sg) => !internalSubgraphIds.has(sg.id));

    const resolvedEdges: ParsedEdge[] = [];
    for (const edge of edges) {
      const fromSg = stepToSubgraph.get(edge.fromStep);
      const toSg = stepToSubgraph.get(edge.toStep);
      if (!toSg || !fromSg) continue;
      if (internalSubgraphIds.has(toSg) || internalSubgraphIds.has(fromSg)) continue;
      edge.fromSubgraph = fromSg;
      edge.toSubgraph = toSg;
      resolvedEdges.push(edge);
    }

    return { subgraphs: flowSubgraphs, edges: resolvedEdges, stepToSubgraph };
  }

  private isIgnorable(line: string): boolean {
    // Comentarios: %% (oficial Mermaid) o % (la IA a veces usa uno solo)
    if (line.startsWith('%')) return true;
    if (line.startsWith('flowchart') || line.startsWith('graph ')) return true;
    if (line.startsWith('style ') || line.startsWith('classDef ') || line.startsWith('class ')) return true;
    if (line.startsWith('direction ')) return true;
    return false;
  }

  private stripTrailingComment(line: string): string {
    // Mermaid soporta %% al inicio y también al final como comentario
    const idx = line.indexOf('%%');
    if (idx >= 0) return line.slice(0, idx).trim();
    return line;
  }

  private parseSubgraphOpen(line: string): { id: string; name: string } | null {
    if (!line.startsWith('subgraph')) return null;
    const rest = line.slice('subgraph'.length).trim();
    if (!rest) return null;

    // Formato: <ID>["<name>"] o <ID>[<name>] o solo <ID>
    // ID puede tener letras (acentuadas), números, _
    const idMatch = rest.match(/^([A-Za-zÀ-ÿ0-9_]+)/);
    if (!idMatch) return null;
    const id = idMatch[1];
    const afterId = rest.slice(id.length).trim();

    let name = id.replace(/_/g, ' ');
    const bracketMatch = afterId.match(/^\[\s*"?([^"\]]+)"?\s*\]/);
    if (bracketMatch) {
      name = bracketMatch[1].trim();
    }

    return { id, name };
  }

  private tokenizeLine(line: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === ' ' || ch === '\t') {
        i++;
        continue;
      }

      // Intentar arrow
      const arrowMatch = this.matchArrow(line, i);
      if (arrowMatch) {
        tokens.push({ type: 'arrow', arrow: arrowMatch.arrow, edgeLabel: arrowMatch.label ?? undefined });
        i = arrowMatch.end;
        continue;
      }

      // Intentar node ID (+ label opcional)
      const nodeMatch = this.matchNode(line, i);
      if (nodeMatch) {
        tokens.push({ type: 'node', id: nodeMatch.id, label: nodeMatch.label ?? undefined });
        i = nodeMatch.end;
        continue;
      }

      // Carácter no reconocido, saltar
      i++;
    }
    return tokens;
  }

  private matchNode(line: string, start: number): { id: string; label: string | null; end: number } | null {
    // ID: [A-Za-z][A-Za-z0-9_]*
    const remainder = line.slice(start);
    const idMatch = remainder.match(/^([A-Za-z][A-Za-z0-9_]*)/);
    if (!idMatch) return null;
    const id = idMatch[1];
    let end = start + id.length;

    // Opcional: [label], {label}, (label), ((label)), [[label]], >label], (["label"])
    // Solo nos interesa extraer el label, no la forma exacta
    const rest = line.slice(end);
    const shapeMatch = rest.match(/^(\[\[|\[\(|\(\(|\{\{|\[|\(|\{|>|\/)/);
    if (shapeMatch) {
      const open = shapeMatch[1];
      const closeMap: Record<string, string> = {
        '[[': ']]',
        '[(': ')]',
        '((': '))',
        '{{': '}}',
        '[': ']',
        '(': ')',
        '{': '}',
        '>': ']',
        '/': '/',
      };
      const close = closeMap[open];
      const afterOpen = end + open.length;
      const closeIdx = this.findClose(line, afterOpen, close);
      if (closeIdx >= 0) {
        let label = line.slice(afterOpen, closeIdx).trim();
        // Quitar comillas si están
        if ((label.startsWith('"') && label.endsWith('"')) || (label.startsWith("'") && label.endsWith("'"))) {
          label = label.slice(1, -1);
        }
        return { id, label, end: closeIdx + close.length };
      }
    }

    return { id, label: null, end };
  }

  private findClose(line: string, from: number, close: string): number {
    // Busca el cierre teniendo en cuenta comillas dobles simples
    let i = from;
    let inQuote = false;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
        i++;
        continue;
      }
      if (!inQuote && line.startsWith(close, i)) {
        return i;
      }
      i++;
    }
    return -1;
  }

  private matchArrow(line: string, start: number): { arrow: '-->' | '-.->'; label: string | null; end: number } | null {
    const rest = line.slice(start);
    // -->|label| o -.->|label| o --> o -.->
    const m = rest.match(/^(-->|-\.->|==>)(\s*\|([^|]*)\|)?/);
    if (!m) return null;
    const arrowStr = m[1] === '==>' ? '-->' : m[1];
    const label = m[3]?.trim() ?? null;
    return { arrow: arrowStr as '-->' | '-.->', label, end: start + m[0].length };
  }

  private addStepToSubgraph(sg: ParsedSubgraph, id: string, label: string | null | undefined): void {
    if (sg.steps.some((s) => s.id === id)) return;
    const step: ParsedStep = { id, label: (label ?? id).trim() };
    sg.steps.push(step);
  }
}
