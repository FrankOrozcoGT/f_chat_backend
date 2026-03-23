import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

export interface FlowSnapshot {
  nodes: { id: string; name: string; systemPrompt: string; todos: any; tools: any }[];
  transitions: { fromNodeId: string; toNodeId: string; transitionCode: string }[];
}

@Injectable()
export class FlowVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveVersion(flowId: string, snapshot: FlowSnapshot, contentHash: string): Promise<{ skipped: boolean }> {
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

  async findById(id: string) {
    return this.prisma.flowVersion.findUnique({ where: { id } });
  }
}
