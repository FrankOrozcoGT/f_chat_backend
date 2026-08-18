import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NodeRepository } from './repositories/node.repository';
import { FlowVersionRepository, FlowSnapshot, DraftFlowSnapshot } from './repositories/flow-version.repository';
import { NodeSessionRepository } from '@common/conversation-session/node-session.repository';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { CreateTransitionDto } from './dto/create-transition.dto';

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
  constructor(
    private readonly nodeRepo: NodeRepository,
    private readonly flowVersionRepo: FlowVersionRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
  ) {}

  async getMyFlows(tenantId: string) {
    const flows = await this.nodeRepo.findAllFlowsByTenantId(tenantId);

    return Promise.all(flows.map(async (flow) => {
      if (flow.nodes.length > 0) {
        return { ...flow, source: 'active' as const };
      }

      const latestVersion = await this.flowVersionRepo.findLatestByFlowId(flow.id);
      if (!latestVersion?.nodesSnapshot) {
        return { ...flow, source: 'active' as const };
      }

      return {
        ...flow,
        ...this.buildDraftFlowView(
          flow.id,
          latestVersion.id,
          latestVersion.version,
          latestVersion.diagramApproved,
          latestVersion.nodesSnapshot,
        ),
      };
    }));
  }

  async getActiveSessions(tenantId: string) {
    const flows = await this.nodeRepo.findAllFlowsByTenantId(tenantId);
    const flowIds = flows.map((f) => f.id);
    if (flowIds.length === 0) return {};
    return this.nodeSessionRepo.countActiveByNode(flowIds);
  }

  async getFlowVersions(flowId: string, tenantId: string) {
    const versions = await this.flowVersionRepo.findByFlowId(flowId, tenantId);
    return versions.map((v) => {
      const snapshot = v.nodesSnapshot as { nodes?: unknown[]; transitions?: unknown[] } | null;
      const nodeCount = Array.isArray(snapshot?.nodes) ? snapshot.nodes.length : 0;
      const transitionCount = Array.isArray(snapshot?.transitions) ? snapshot.transitions.length : 0;
      return {
        id: v.id,
        version: v.version,
        nodeCount,
        transitionCount,
        hasDiagram: !!v.consolidatedDiagram,
        diagramApproved: v.diagramApproved,
        diagramModified: v.diagramModified,
        isPromoted: v.isPromoted,
        createdAt: v.createdAt,
      };
    });
  }

  async getFlowVersion(flowId: string, versionId: string, tenantId: string) {
    const version = await this.flowVersionRepo.findById(versionId, tenantId);
    if (!version || version.flowId !== flowId) {
      throw new NotFoundException(`Version ${versionId} not found for flow ${flowId}`);
    }

    const flow = await this.nodeRepo.findFlowById(flowId);
    if (!flow) throw new NotFoundException(`Flow ${flowId} not found`);

    return {
      ...flow,
      ...this.buildDraftFlowView(
        flowId,
        version.id,
        version.version,
        version.diagramApproved,
        version.nodesSnapshot,
      ),
      consolidatedDiagram: version.consolidatedDiagram,
      nodeCategories: version.nodeCategories,
      internalQueues: version.internalQueues,
    };
  }

  async promoteFlow(flowId: string, tenantId: string) {
    // Toma el último snapshot del historial y lo aplica al flow
    const versions = await this.flowVersionRepo.findByFlowId(flowId, tenantId);
    if (versions.length === 0) throw new BadRequestException('No versions in history to promote');

    const latest = versions[0]; // findByFlowId retorna desc por version
    await this.applySnapshot(flowId, latest.nodesSnapshot as unknown as FlowSnapshot);
    await this.flowVersionRepo.markAsPromoted(latest.id);
    return { promoted: true, flowId, versionId: latest.id };
  }

  async restoreFlowVersion(flowId: string, versionId: string, tenantId: string) {
    const version = await this.flowVersionRepo.findById(versionId, tenantId);
    if (!version) throw new NotFoundException('Version not found');
    if (version.flowId !== flowId) throw new BadRequestException('Version does not belong to this flow');

    await this.applySnapshot(flowId, version.nodesSnapshot as unknown as FlowSnapshot);
    return { restored: true, flowId, versionId };
  }

  async createNode(tenantId: string, body: CreateNodeDto) {
    return this.nodeRepo.createNode({
      ...body,
      tools: body.tools as Prisma.InputJsonValue,
      preCodeInputSchema: body.preCodeInputSchema as Prisma.InputJsonValue,
      postCodeInputSchema: body.postCodeInputSchema as Prisma.InputJsonValue,
      todos: body.todos as Prisma.InputJsonValue,
      tenant: { connect: { id: tenantId } },
    });
  }

  async updateNode(id: string, tenantId: string, body: UpdateNodeDto) {
    const data: Prisma.NodeUpdateInput = {
      ...body,
      tools: body.tools as Prisma.InputJsonValue,
      preCodeInputSchema: body.preCodeInputSchema as Prisma.InputJsonValue,
      postCodeInputSchema: body.postCodeInputSchema as Prisma.InputJsonValue,
      todos: body.todos as Prisma.InputJsonValue,
    };
    const result = await this.nodeRepo.updateNode(id, tenantId, data);
    if (!result) throw new NotFoundException('Node not found');
    return result;
  }

  async addNodeToFlow(flowId: string, nodeId: string, tenantId: string) {
    const flow = await this.nodeRepo.findFlowById(flowId);
    if (!flow || flow.tenantId !== tenantId) throw new NotFoundException('Flow not found');
    return this.nodeRepo.addNodeToFlow(flowId, nodeId);
  }

  async createTransition(flowId: string, tenantId: string, dto: CreateTransitionDto) {
    const flow = await this.nodeRepo.findFlowById(flowId);
    if (!flow || flow.tenantId !== tenantId) throw new NotFoundException('Flow not found');
    return this.nodeRepo.createTransition({ flowId, ...dto });
  }

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
