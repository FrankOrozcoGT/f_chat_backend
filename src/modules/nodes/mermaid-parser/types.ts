export interface ParsedStep {
  id: string;
  label: string;
}

export interface ParsedSubgraph {
  id: string;
  name: string;
  steps: ParsedStep[];
}

export interface ParsedEdge {
  fromStep: string;
  toStep: string;
  fromSubgraph: string;
  toSubgraph: string;
  label: string | null;
  isInternal: boolean;
}

export interface ParsedDiagram {
  subgraphs: ParsedSubgraph[];
  edges: ParsedEdge[];
  stepToSubgraph: Map<string, string>;
}

export interface CrossEdge {
  fromSubgraph: string;
  toSubgraph: string;
  label: string | null;
  isInternal: boolean;
  goesToRouter: boolean;
}

export interface SubFlow {
  entrySubgraph: string;
  subgraphIds: string[];
}

export interface FlowGraph {
  subgraphs: ParsedSubgraph[];
  crossEdges: CrossEdge[];
  entryPoints: string[];
  terminals: string[];
  subFlows: SubFlow[];
  discardedClosureSubgraphs: string[];
}
