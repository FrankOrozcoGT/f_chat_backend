import { Injectable, BadRequestException } from '@nestjs/common';
import { NodeRepository } from './repositories/node.repository';
import { FlowSnapshot, DraftFlowSnapshot } from './repositories/flow-version.repository';

interface DraftSnapshotNode {
  name: string;
  systemPrompt: string;
  tools?: unknown;
  todos?: unknown;
}

interface DraftSnapshotTransition {
  fromNodeIndex: number;
  toNodeIndex: number;
  transitionCode: string;
}

export interface DraftFlowView {
  source: 'version';
  versionId: string;
  versionNumber: number;
  diagramApproved: boolean;
  nodes: {
    nodeId: string;
    flowId: string;
    node: {
      id: string;
      name: string;
      systemPrompt: string;
      tools: unknown;
      todos: unknown;
    };
  }[];
  transitions: {
    id: string;
    flowId: string;
    fromNodeId: string;
    toNodeId: string;
    transitionCode: string;
    fromNode: { id: string; name: string };
    toNode: { id: string; name: string };
  }[];
}

@Injectable()
export class NodesService {
  constructor(private readonly nodeRepo: NodeRepository) {}

  /**
   * Convierte un nodesSnapshot (formato draft, nodos por índice) al shape
   * de flow "activo" (nodeId/fromNodeId/toNodeId) que consume el frontend.
   */
  buildDraftFlowView(
    flowId: string,
    versionId: string,
    versionNumber: number,
    diagramApproved: boolean,
    nodesSnapshot: unknown,
  ): DraftFlowView {
    const snapshot = nodesSnapshot as { nodes?: DraftSnapshotNode[]; transitions?: DraftSnapshotTransition[] } | null;
    const snapshotNodes: DraftSnapshotNode[] = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
    const snapshotTransitions: DraftSnapshotTransition[] = Array.isArray(snapshot?.transitions)
      ? snapshot.transitions
      : [];

    return {
      source: 'version',
      versionId,
      versionNumber,
      diagramApproved,
      nodes: snapshotNodes.map((n, i) => ({
        nodeId: `draft-${i}`,
        flowId,
        node: {
          id: `draft-${i}`,
          name: n.name,
          systemPrompt: n.systemPrompt,
          tools: n.tools ?? null,
          todos: n.todos ?? null,
        },
      })),
      transitions: snapshotTransitions.map((t) => ({
        id: `draft-t-${t.fromNodeIndex}-${t.toNodeIndex}`,
        flowId,
        fromNodeId: `draft-${t.fromNodeIndex}`,
        toNodeId: `draft-${t.toNodeIndex}`,
        transitionCode: t.transitionCode,
        fromNode: { id: `draft-${t.fromNodeIndex}`, name: snapshotNodes[t.fromNodeIndex]?.name ?? '' },
        toNode: { id: `draft-${t.toNodeIndex}`, name: snapshotNodes[t.toNodeIndex]?.name ?? '' },
      })),
    };
  }

  /**
   * Aplica un snapshot (draft o promovido) como los nodos/transiciones activos de un flow.
   */
  async applySnapshot(flowId: string, snap: FlowSnapshot | DraftFlowSnapshot): Promise<void> {
    const firstNode = snap.nodes[0] as { id?: string } | undefined;
    const isDraft = !firstNode || !('id' in firstNode) || firstNode.id === '';

    if (isDraft) {
      const draft = snap as DraftFlowSnapshot;
      await this.nodeRepo.replaceFlowNodes(
        flowId,
        draft.nodes.map((n) => ({ id: '', ...n })),
        draft.transitions,
      );
    } else {
      const promoted = snap as FlowSnapshot;
      const transitions = promoted.transitions.map((t) => {
        const fromNodeIndex = promoted.nodes.findIndex((n) => n.id === t.fromNodeId);
        const toNodeIndex = promoted.nodes.findIndex((n) => n.id === t.toNodeId);
        if (fromNodeIndex === -1 || toNodeIndex === -1) {
          throw new BadRequestException(`Snapshot has invalid transition: ${t.transitionCode}`);
        }
        return { fromNodeIndex, toNodeIndex, transitionCode: t.transitionCode };
      });
      await this.nodeRepo.replaceFlowNodes(flowId, promoted.nodes, transitions);
    }
  }
}
