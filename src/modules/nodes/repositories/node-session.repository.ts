import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Prisma, NodeSessionStatus } from '@prisma/client';

@Injectable()
export class NodeSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.nodeSession.findUnique({
      where: { id },
      include: { currentNode: true, flow: true },
    });
  }

  async findActiveByConversationId(conversationId: string) {
    return this.prisma.nodeSession.findFirst({
      where: { conversationId, status: 'active' },
      include: { currentNode: true, flow: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveOrWaitingByConversationId(conversationId: string) {
    return this.prisma.nodeSession.findFirst({
      where: { conversationId, status: { in: ['active', 'waiting_queue'] } },
      include: { currentNode: true, flow: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(conversationId: string, flowId?: string) {
    return this.prisma.nodeSession.create({
      data: { conversationId, flowId: flowId ?? null },
      include: { currentNode: true, flow: true },
    });
  }

  async findOrCreate(conversationId: string, flowId?: string) {
    const existing = await this.findActiveByConversationId(conversationId);
    if (existing) return existing;
    return this.create(conversationId, flowId);
  }

  async updateCurrentNode(
    id: string,
    currentNodeId: string | null,
    detectedIntent?: string,
    flowId?: string,
  ) {
    const data: any = { currentNodeId, detectedIntent, cachedNodeData: Prisma.DbNull };
    if (flowId !== undefined) data.flowId = flowId;
    return this.prisma.nodeSession.update({
      where: { id },
      data,
      include: { currentNode: true, flow: true },
    });
  }

  async setCachedNodeData(id: string, data: unknown) {
    await this.prisma.nodeSession.update({
      where: { id },
      data: { cachedNodeData: data as any },
    });
  }

  async updateStatus(id: string, status: NodeSessionStatus) {
    return this.prisma.nodeSession.update({
      where: { id },
      data: { status },
      include: { currentNode: true, flow: true },
    });
  }

  async pauseFlow(id: string, flowSummary: string) {
    return this.prisma.nodeSession.update({
      where: { id },
      data: { currentNodeId: null, detectedIntent: null, flowId: null, flowSummary },
    });
  }

  async close(id: string) {
    return this.prisma.nodeSession.update({
      where: { id },
      data: { status: 'closed' },
    });
  }

  async countActiveByNode(flowIds: string[]) {
    const results = await this.prisma.nodeSession.groupBy({
      by: ['currentNodeId'],
      where: {
        flowId: { in: flowIds },
        status: 'active',
        currentNodeId: { not: null },
      },
      _count: { id: true },
    });
    const map: Record<string, number> = {};
    for (const r of results) {
      if (r.currentNodeId) map[r.currentNodeId] = r._count.id;
    }
    return map;
  }
}
