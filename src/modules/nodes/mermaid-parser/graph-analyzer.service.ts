import { Injectable, Logger } from '@nestjs/common';
import { CrossEdge, FlowGraph, ParsedDiagram, SubFlow } from './types';

@Injectable()
export class GraphAnalyzer {
  private readonly logger = new Logger(GraphAnalyzer.name);

  analyze(diagram: ParsedDiagram): FlowGraph {
    const discardedClosureSubgraphs = diagram.subgraphs
      .filter((sg) => sg.name.trim().toLowerCase() === 'cierre')
      .map((sg) => sg.id);
    const discardedSet = new Set(discardedClosureSubgraphs);

    const activeSubgraphs = diagram.subgraphs.filter((sg) => !discardedSet.has(sg.id));

    const crossEdges: CrossEdge[] = [];
    const seen = new Set<string>();
    for (const edge of diagram.edges) {
      if (edge.fromSubgraph === edge.toSubgraph) continue;
      const fromDiscarded = discardedSet.has(edge.fromSubgraph);
      const toDiscarded = discardedSet.has(edge.toSubgraph);
      // Ignorar aristas que salen de un subgraph Cierre (no tiene sentido)
      if (fromDiscarded) continue;
      const key = `${edge.fromSubgraph}|${edge.toSubgraph}|${edge.label ?? ''}|${edge.isInternal}|${toDiscarded}`;
      if (seen.has(key)) continue;
      seen.add(key);
      crossEdges.push({
        fromSubgraph: edge.fromSubgraph,
        toSubgraph: edge.toSubgraph,
        label: edge.label,
        isInternal: edge.isInternal,
        goesToRouter: toDiscarded,
      });
    }

    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const sg of activeSubgraphs) {
      inDegree.set(sg.id, 0);
      outDegree.set(sg.id, 0);
    }
    for (const e of crossEdges) {
            // Las aristas que van al router cuentan como out del origen pero NO in del destino
      if (!e.goesToRouter) {
        inDegree.set(e.toSubgraph, (inDegree.get(e.toSubgraph) ?? 0) + 1);
      }
      outDegree.set(e.fromSubgraph, (outDegree.get(e.fromSubgraph) ?? 0) + 1);
    }

    const entryPoints = activeSubgraphs.filter((sg) => (inDegree.get(sg.id) ?? 0) === 0).map((sg) => sg.id);
    const terminals = activeSubgraphs.filter((sg) => (outDegree.get(sg.id) ?? 0) === 0).map((sg) => sg.id);

    const adjacency = new Map<string, Set<string>>();
    for (const sg of activeSubgraphs) adjacency.set(sg.id, new Set());
    for (const e of crossEdges) {
            if (e.goesToRouter) continue;
      adjacency.get(e.fromSubgraph)!.add(e.toSubgraph);
    }

    const subFlows: SubFlow[] = [];
    const globallyReached = new Set<string>();

    for (const entry of entryPoints) {
      const reachable = new Set<string>();
      const queue: string[] = [entry];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);
        for (const next of adjacency.get(current) ?? []) {
          if (!reachable.has(next)) queue.push(next);
        }
      }
      for (const id of reachable) globallyReached.add(id);
      subFlows.push({ entrySubgraph: entry, subgraphIds: [...reachable] });
    }

    // Nodos no alcanzados desde ningún entry: agregarlos como subFlow propio (entry = ellos mismos si no tienen predecesor alcanzable)
    const unreached = activeSubgraphs.filter((sg) => !globallyReached.has(sg.id)).map((sg) => sg.id);
    if (unreached.length > 0) {
      // Estos nodos forman ciclos cerrados sin entry claro — tomamos el primero como entry sintético
      const reachable = new Set<string>();
      const queue = [unreached[0]];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);
        for (const next of adjacency.get(current) ?? []) {
          if (!reachable.has(next)) queue.push(next);
        }
      }
      subFlows.push({ entrySubgraph: unreached[0], subgraphIds: [...reachable] });
      if (!entryPoints.includes(unreached[0])) entryPoints.push(unreached[0]);
    }

    this.logger.log(
      `GraphAnalyzer: subgraphs=${activeSubgraphs.length} (${activeSubgraphs.map((s) => s.name).join(', ')}), ` +
      `crossEdges=${crossEdges.length}, ` +
      `entryPoints=${entryPoints.length} (${entryPoints.map((id) => activeSubgraphs.find((s) => s.id === id)?.name ?? id).join(', ')}), ` +
      `subFlows=${subFlows.length}`,
    );
    for (const e of crossEdges) {
      const from = activeSubgraphs.find((s) => s.id === e.fromSubgraph)?.name ?? e.fromSubgraph;
      const to = activeSubgraphs.find((s) => s.id === e.toSubgraph)?.name ?? e.toSubgraph;
      this.logger.log(`GraphAnalyzer crossEdge: ${from} --> ${to}${e.label ? ` [${e.label}]` : ''}${e.isInternal ? ' (internal)' : ''}${e.goesToRouter ? ' (router)' : ''}`);
    }

    return {
      subgraphs: activeSubgraphs,
      crossEdges,
      entryPoints,
      terminals,
      subFlows,
      discardedClosureSubgraphs,
    };
  }
}
