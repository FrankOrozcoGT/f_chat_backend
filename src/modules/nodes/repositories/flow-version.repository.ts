import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

export interface FlowSnapshot {
  nodes: { id: string; name: string; systemPrompt: string; todos: any; tools: any }[];
  transitions: { fromNodeId: string; toNodeId: string; transitionCode: string }[];
}

// Snapshot generado por IA antes de promote — los nodos no tienen IDs aún
export interface DraftFlowSnapshot {
  nodes: { name: string; systemPrompt: string; todos: any; tools: any }[];
  transitions: { fromNodeIndex: number; toNodeIndex: number; transitionCode: string }[];
  selectedCases?: { flowSummary: string; flowDiagram: string }[];
}

@Injectable()
export class FlowVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveVersion(
    flowId: string,
    snapshot: FlowSnapshot | DraftFlowSnapshot,
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
        nodesSnapshot: snapshot as any,
        contentHash,
        proposedTools: proposedTools ? (proposedTools as any) : undefined,
      },
    });

    return { skipped: false };
  }

  async findByFlowId(flowId: string) {
    return this.prisma.flowVersion.findMany({
      where: { flowId },
      orderBy: { version: 'desc' },
    });
  }

  async findLatestByFlowId(flowId: string) {
    return this.prisma.flowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
    });
  }

  async findById(id: string) {
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
      select: { id: true, consolidatedDiagram: true, diagramApproved: true, diagramModified: true, version: true },
    });
  }

  async saveConsolidatedDiagram(flowId: string, diagram: string): Promise<void> {
    const latest = await this.prisma.flowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });

    if (latest) {
      await this.prisma.flowVersion.update({
        where: { id: latest.id },
        data: { consolidatedDiagram: diagram, diagramApproved: false, diagramModified: false },
      });
    } else {
      await this.prisma.flowVersion.create({
        data: {
          flowId,
          version: 1,
          nodesSnapshot: {},
          contentHash: '',
          consolidatedDiagram: diagram,
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
