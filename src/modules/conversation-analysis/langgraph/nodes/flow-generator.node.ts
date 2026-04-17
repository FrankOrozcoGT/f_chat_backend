import { Injectable, Logger } from '@nestjs/common';
import { TodoDefinition } from '@modules/nodes/functions/implementations/update-todos.fn';
import { MermaidParser } from '@modules/nodes/mermaid-parser/mermaid-parser.service';
import { GraphAnalyzer } from '@modules/nodes/mermaid-parser/graph-analyzer.service';
import { CrossEdge, ParsedSubgraph, SubFlow } from '@modules/nodes/mermaid-parser/types';
import { NodeContentGeneratorNode, ProposedTool } from './node-content-generator.node';
import { IntentSplitterNode } from './intent-splitter.node';

export interface InternalQueueEntry {
  channelName: string;
  nodeId: string;
  queueType: string;
  usage: string;
}

export interface GeneratedNode {
  name: string;
  systemPrompt: string;
  todos: TodoDefinition[];
  tools: string[];
}

export interface GeneratedTransition {
  fromNodeIndex: number;
  toNodeIndex: number;
  transitionCode: string;
}

export type { ProposedTool };

export interface GeneratedFlow {
  intentName: string;
  isSplitChild: boolean;
  nodes: GeneratedNode[];
  transitions: GeneratedTransition[];
  proposedTools: ProposedTool[];
  assignedAnalysisIds: string[];
  costUsd: number;
}

export interface FlowGeneratorInput {
  intentName: string;
  consolidatedDiagram: string;
  internalQueues: InternalQueueEntry[];
  analyses: { id: string; flowSummary: string | null; flowDiagram: string | null }[];
}

export interface FlowGeneratorOutput {
  flows: GeneratedFlow[];
  totalCostUsd: number;
}

@Injectable()
export class FlowGeneratorNode {
  private readonly logger = new Logger(FlowGeneratorNode.name);

  constructor(
    private readonly mermaidParser: MermaidParser,
    private readonly graphAnalyzer: GraphAnalyzer,
    private readonly nodeContentGenerator: NodeContentGeneratorNode,
    private readonly intentSplitter: IntentSplitterNode,
  ) {}

  async generate(input: FlowGeneratorInput): Promise<FlowGeneratorOutput> {
    const parsed = this.mermaidParser.parse(input.consolidatedDiagram);
    const graph = this.graphAnalyzer.analyze(parsed);

    this.logger.log(
      `FlowGenerator [${input.intentName}]: ${graph.subgraphs.length} nodes, ${graph.crossEdges.length} cross-edges, ` +
      `${graph.entryPoints.length} entries, ${graph.terminals.length} terminals, ` +
      `${graph.discardedClosureSubgraphs.length} closures discarded`,
    );

    const isSplit = graph.subFlows.length > 1;
    let intentNameBySubFlow = new Map<string, string>();
    let analysisAssignments = new Map<string, string>();
    let splitterCost = 0;

    if (isSplit) {
      const subgraphById = new Map(graph.subgraphs.map((s) => [s.id, s]));
      const result = await this.intentSplitter.split({
        originalIntent: input.intentName,
        subFlows: graph.subFlows.map((sf) => ({
          entrySubgraph: sf.entrySubgraph,
          entryNodeName: subgraphById.get(sf.entrySubgraph)?.name ?? sf.entrySubgraph,
          reachableNodeNames: sf.subgraphIds.map((id) => subgraphById.get(id)?.name ?? id),
        })),
        analyses: input.analyses.map((a) => ({
          analysisId: a.id,
          flowSummary: a.flowSummary,
          flowDiagram: a.flowDiagram,
        })),
      });
      for (const s of result.splits) intentNameBySubFlow.set(s.entrySubgraph, s.newIntentName);
      for (const a of result.assignments) analysisAssignments.set(a.analysisId, a.entrySubgraph);
      splitterCost = result.costUsd;
    } else {
      intentNameBySubFlow.set(graph.subFlows[0].entrySubgraph, input.intentName);
      for (const a of input.analyses) analysisAssignments.set(a.id, graph.subFlows[0].entrySubgraph);
    }

    const flows: GeneratedFlow[] = [];
    let totalCostUsd = splitterCost;

    for (const subFlow of graph.subFlows) {
      const flow = await this.generateSubFlow(subFlow, graph.subgraphs, graph.crossEdges, input, intentNameBySubFlow.get(subFlow.entrySubgraph)!, isSplit);
      const assignedAnalysisIds = [...analysisAssignments.entries()]
        .filter(([, entry]) => entry === subFlow.entrySubgraph)
        .map(([id]) => id);
      flow.assignedAnalysisIds = assignedAnalysisIds;
      flows.push(flow);
      totalCostUsd += flow.costUsd;
    }

    this.logger.log(
      `FlowGenerator [${input.intentName}]: generated ${flows.length} flow(s), totalCost=$${totalCostUsd.toFixed(6)}`,
    );

    return { flows, totalCostUsd };
  }

  private async generateSubFlow(
    subFlow: SubFlow,
    allSubgraphs: ParsedSubgraph[],
    allCrossEdges: CrossEdge[],
    input: FlowGeneratorInput,
    intentName: string,
    isSplitChild: boolean,
  ): Promise<GeneratedFlow> {
    const subgraphById = new Map(allSubgraphs.map((s) => [s.id, s]));
    const includedIds = new Set(subFlow.subgraphIds);
    const orderedIds = this.orderSubgraphs(subFlow, allCrossEdges);

    const internalsByNodeId = new Map<string, InternalQueueEntry[]>();
    for (const iq of input.internalQueues) {
      const sgId = this.findSubgraphByNodeRef(iq.nodeId, subgraphById);
      if (sgId && includedIds.has(sgId)) {
        const arr = internalsByNodeId.get(sgId) ?? [];
        arr.push(iq);
        internalsByNodeId.set(sgId, arr);
      }
    }

    const outgoingBySubgraph = new Map<string, CrossEdge[]>();
    for (const e of allCrossEdges) {
      if (e.isInternal) continue;
      if (!includedIds.has(e.fromSubgraph)) continue;
      if (!e.goesToRouter && !includedIds.has(e.toSubgraph)) continue;
      const arr = outgoingBySubgraph.get(e.fromSubgraph) ?? [];
      arr.push(e);
      outgoingBySubgraph.set(e.fromSubgraph, arr);
    }

    const nodeGenerations = await Promise.all(
      orderedIds.map(async (sgId) => {
        const sg = subgraphById.get(sgId)!;
        const outgoing = outgoingBySubgraph.get(sgId) ?? [];
        const isTerminal = outgoing.length === 0 || outgoing.every((e) => e.goesToRouter);

        const content = await this.nodeContentGenerator.generate({
          intentName,
          nodeName: sg.name,
          steps: sg.steps,
          isTerminal,
        });

        return { sgId, sg, content, outgoing, isTerminal };
      }),
    );

    const nameToIndex = new Map<string, number>();
    orderedIds.forEach((id, i) => nameToIndex.set(subgraphById.get(id)!.name, i));

    const nodes: GeneratedNode[] = nodeGenerations.map((g) => {
      const enrichedTodos = this.buildFullTodos(
        g.content.node.todos,
        g.outgoing,
        subgraphById,
        internalsByNodeId.get(g.sgId) ?? [],
        g.isTerminal,
        g.content.node.isClosureNode,
      );
      const finalizingTools = this.collectFinalizingTools(g.outgoing, internalsByNodeId.get(g.sgId) ?? [], g.isTerminal, g.content.node.isClosureNode);
      const allTools = [...new Set([...g.content.node.tools, ...finalizingTools])];
      return {
        name: g.sg.name,
        systemPrompt: g.content.node.systemPrompt,
        todos: enrichedTodos,
        tools: allTools,
      };
    });

    const transitions: GeneratedTransition[] = [];
    for (let i = 0; i < orderedIds.length; i++) {
      const fromId = orderedIds[i];
      const outgoing = outgoingBySubgraph.get(fromId) ?? [];
      for (const e of outgoing) {
        if (e.goesToRouter) continue;
        const toIndex = nameToIndex.get(subgraphById.get(e.toSubgraph)!.name);
        if (toIndex === undefined) continue;
        transitions.push({
          fromNodeIndex: i,
          toNodeIndex: toIndex,
          transitionCode: this.toTransitionCode(e.label),
        });
      }
    }

    const proposedTools: ProposedTool[] = [];
    const seenToolNames = new Set<string>();
    let costUsd = 0;
    for (const g of nodeGenerations) {
      costUsd += g.content.costUsd;
      for (const p of g.content.proposedTools) {
        if (!seenToolNames.has(p.name)) {
          seenToolNames.add(p.name);
          proposedTools.push(p);
        }
      }
    }

    return {
      intentName,
      isSplitChild,
      nodes,
      transitions,
      proposedTools,
      assignedAnalysisIds: [],
      costUsd,
    };
  }

  /** BFS desde el entry para ordenar los subgraphs; el primero siempre es el entry point */
  private orderSubgraphs(subFlow: SubFlow, allCrossEdges: CrossEdge[]): string[] {
    const included = new Set(subFlow.subgraphIds);
    const ordered: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [subFlow.entrySubgraph];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      ordered.push(current);
      for (const e of allCrossEdges) {
        if (e.isInternal || e.goesToRouter) continue;
        if (e.fromSubgraph !== current) continue;
        if (!included.has(e.toSubgraph) || visited.has(e.toSubgraph)) continue;
        queue.push(e.toSubgraph);
      }
    }
    // Agregar los que no quedaron por ciclos raros
    for (const id of subFlow.subgraphIds) {
      if (!visited.has(id)) ordered.push(id);
    }
    return ordered;
  }

  private findSubgraphByNodeRef(
    nodeRef: string,
    subgraphById: Map<string, ParsedSubgraph>,
  ): string | null {
    // nodeRef puede ser el step id (Cx) o el subgraph id
    for (const [id, sg] of subgraphById) {
      if (id === nodeRef) return id;
      if (sg.steps.some((s) => s.id === nodeRef)) return id;
    }
    return null;
  }

  private toTransitionCode(label: string | null): string {
    if (!label) return 'default';
    return label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Construye los todos finales del nodo: los internos que generó la IA + todos deterministas
   * (uno por internal, uno por transición saliente, uno terminal si aplica).
   */
  private buildFullTodos(
    internalTodos: TodoDefinition[],
    outgoing: CrossEdge[],
    subgraphById: Map<string, ParsedSubgraph>,
    internals: InternalQueueEntry[],
    isTerminal: boolean,
    isClosureNode: boolean,
  ): TodoDefinition[] {
    const todos: TodoDefinition[] = [...internalTodos];

    for (const internal of internals) {
      todos.push({
        id: `coordinate_${internal.channelName}`,
        name: `Coordinar con ${internal.channelName}`,
        description: `${internal.usage} Usa sendToInternalChannel con channelName="${internal.channelName}". Tipo de cola: ${internal.queueType}. La conversación se pausa esperando respuesta.`,
        functions: ['sendToInternalChannel'],
      });
    }

    for (const edge of outgoing) {
      if (edge.goesToRouter) continue;
      const toName = subgraphById.get(edge.toSubgraph)?.name ?? edge.toSubgraph;
      const code = this.toTransitionCode(edge.label);
      todos.push({
        id: `transition_${code}`,
        name: `Transicionar a ${toName}`,
        description: `Cuando corresponda según la lógica del nodo, usa transitionToNode con transitionCode="${code}" para pasar al nodo "${toName}".${edge.label ? ` Condición: ${edge.label}.` : ''}`,
        functions: ['transitionToNode'],
        transitions: [code],
      });
    }

    if (isTerminal) {
      const terminalTool = isClosureNode ? 'closeSession' : 'exitFlow';
      todos.push({
        id: 'finalize_flow',
        name: isClosureNode ? 'Cerrar conversación' : 'Salir del flow',
        description: isClosureNode
          ? 'Cuando la interacción en este nodo termine, usa closeSession para despedirte y cerrar la conversación.'
          : 'Cuando la tarea de este nodo esté completa, usa exitFlow para salir del flow al router.',
        functions: [terminalTool],
        transitions: ['finalize'],
      });
    }

    return todos;
  }

  /** Tools que se añaden al nodo porque las añadimos deterministicamente en los todos */
  private collectFinalizingTools(
    outgoing: CrossEdge[],
    internals: InternalQueueEntry[],
    isTerminal: boolean,
    isClosureNode: boolean,
  ): string[] {
    const tools: string[] = [];
    if (internals.length > 0) tools.push('sendToInternalChannel');
    if (outgoing.some((e) => !e.goesToRouter)) tools.push('transitionToNode');
    if (isTerminal) tools.push(isClosureNode ? 'closeSession' : 'exitFlow');
    return tools;
  }
}
