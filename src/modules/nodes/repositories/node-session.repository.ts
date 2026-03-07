import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class NodeSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByConversationId(conversationId: string) {
    return this.prisma.nodeSession.findFirst({
      where: { conversationId, status: 'active' },
      include: { currentNode: true, flow: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(conversationId: string, flowId: string) {
    return this.prisma.nodeSession.create({
      data: { conversationId, flowId },
      include: { currentNode: true, flow: true },
    });
  }

  async findOrCreate(conversationId: string, flowId: string) {
    const existing = await this.findActiveByConversationId(conversationId);
    if (existing) return existing;
    return this.create(conversationId, flowId);
  }

  async updateCurrentNode(
    id: string,
    currentNodeId: string | null,
    detectedIntent?: string,
  ) {
    return this.prisma.nodeSession.update({
      where: { id },
      data: { currentNodeId, detectedIntent },
      include: { currentNode: true, flow: true },
    });
  }

  async close(id: string) {
    return this.prisma.nodeSession.update({
      where: { id },
      data: { status: 'closed' },
    });
  }
}
