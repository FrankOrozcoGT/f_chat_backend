import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';

export interface FlowVersionNodeMappingEntry {
  conversationId: string;
  nodeId: string;
}

export interface FlowVersionInternalQueueEntry {
  channelName: string;
  nodeId: string;
  queueType: 'fifo' | 'batch_reply' | 'llm_flexible';
  usage: string;
}

export interface FlowVersionRepresentativeCase {
  conversationId: string;
  path: string[];
  reason: string;
}

export interface FlowSnapshot {
  nodes: { id: string; name: string; systemPrompt: string; todos: any; tools: any }[];
  transitions: { fromNodeId: string; toNodeId: string; transitionCode: string }[];
}

// Snapshot generado por IA antes de promote — los nodos no tienen IDs aún
export interface DraftFlowSnapshot {
  nodes: { name: string; systemPrompt: string; todos: any; tools: any }[];
  transitions: { fromNodeIndex: number; toNodeIndex: number; transitionCode: string }[];
}

@Injectable()
export class FlowVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveVersion(
    flowId: string,
    snapshot: DraftFlowSnapshot | FlowSnapshot,
    contentHash: string,
    proposedTools?: { name: string; description: string }[],
  ): Promise<{ skipped: boolean }> {
    const last = await this.prisma.flowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
      select: { contentHash: true, version: true },
    });

    if (last?.contentHash === contentHash) {
      return { skipped: true };
    }

    const nextVersion = (last?.version ?? 0) + 1;

    await this.prisma.flowVersion.create({
      data: {
        flowId,
        version: nextVersion,
        nodesSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        contentHash,
        proposedTools: (proposedTools ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      },
    });

    return { skipped: false };
  }

  async updateVersionNodes(
    versionId: string,
    snapshot: DraftFlowSnapshot | FlowSnapshot,
    contentHash: string,
    proposedTools?: { name: string; description: string }[],
  ): Promise<void> {
    await this.prisma.flowVersion.update({
      where: { id: versionId },
      data: {
        nodesSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        contentHash,
        proposedTools: (proposedTools ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async findByFlowId(flowId: string, tenantId: string) {
    return this.prisma.flowVersion.findMany({
      where: { flowId, flow: { tenantId } },
      orderBy: { version: 'desc' },
    });
  }

  async findLatestByFlowId(flowId: string) {
    return this.prisma.flowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
    });
  }

  async findById(id: string, tenantId?: string) {
    if (tenantId) {
      return this.prisma.flowVersion.findFirst({ where: { id, flow: { tenantId } } });
    }
    return this.prisma.flowVersion.findUnique({ where: { id } });
  }

  async findPromotedByFlowId(flowId: string) {
    return this.prisma.flowVersion.findFirst({
      where: { flowId, isPromoted: true },
      orderBy: { version: 'desc' },
    });
  }

  async findLatestWithDiagram(flowId: string) {
    return this.prisma.flowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
      select: { id: true, consolidatedDiagram: true, nodeMapping: true, nodeCategories: true, internalQueues: true, representativeCases: true, diagramApproved: true, diagramModified: true, version: true },
    });
  }

  async saveConsolidatedDiagram(
    flowId: string,
    diagram: string,
    nodeMapping: Record<string, FlowVersionNodeMappingEntry[]>,
    nodeCategories: Record<string, string>,
    internalQueues: FlowVersionInternalQueueEntry[],
    representativeCases: FlowVersionRepresentativeCase[],
  ): Promise<void> {
    const latest = await this.prisma.flowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });

    const jsonNodeMapping = nodeMapping as unknown as Prisma.InputJsonValue;
    const jsonNodeCategories = nodeCategories as unknown as Prisma.InputJsonValue;
    const jsonInternalQueues = internalQueues as unknown as Prisma.InputJsonValue;
    const jsonRepresentativeCases = representativeCases as unknown as Prisma.InputJsonValue;

    if (latest) {
      await this.prisma.flowVersion.update({
        where: { id: latest.id },
        data: {
          consolidatedDiagram: diagram,
          nodeMapping: jsonNodeMapping,
          nodeCategories: jsonNodeCategories,
          internalQueues: jsonInternalQueues,
          representativeCases: jsonRepresentativeCases,
          diagramApproved: false,
          diagramModified: false,
        },
      });
    } else {
      await this.prisma.flowVersion.create({
        data: {
          flowId,
          version: 1,
          nodesSnapshot: {},
          contentHash: '',
          consolidatedDiagram: diagram,
          nodeMapping: jsonNodeMapping,
          nodeCategories: jsonNodeCategories,
          internalQueues: jsonInternalQueues,
          representativeCases: jsonRepresentativeCases,
          diagramApproved: false,
          diagramModified: false,
        },
      });
    }
  }

  async updateDiagram(versionId: string, diagram: string): Promise<void> {
    await this.prisma.flowVersion.update({
      where: { id: versionId },
      data: { consolidatedDiagram: diagram, diagramModified: true },
    });
  }

  async approveDiagram(flowId: string): Promise<void> {
    const latest = await this.prisma.flowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
      select: { id: true, consolidatedDiagram: true },
    });
    if (!latest) throw new Error(`No FlowVersion found for flowId ${flowId}`);
    if (!latest.consolidatedDiagram) throw new Error(`FlowVersion for flow ${flowId} has no consolidatedDiagram to approve`);
    await this.prisma.flowVersion.update({
      where: { id: latest.id },
      data: { diagramApproved: true },
    });
  }

  async markAsPromoted(versionId: string): Promise<void> {
    const version = await this.prisma.flowVersion.findUnique({
      where: { id: versionId },
      select: { flowId: true },
    });
    if (!version) throw new Error(`FlowVersion ${versionId} not found`);

    await this.prisma.$transaction([
      this.prisma.flowVersion.updateMany({
        where: { flowId: version.flowId },
        data: { isPromoted: false },
      }),
      this.prisma.flowVersion.update({
        where: { id: versionId },
        data: { isPromoted: true },
      }),
    ]);
  }
}
