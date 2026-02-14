import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { FlowData } from '../langgraph/state.interface';

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByConversationId(conversationId: string) {
    return this.prisma.session.findFirst({
      where: { conversationId, type: 'AI', endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  async create(conversationId: string) {
    return this.prisma.session.create({
      data: { conversationId, type: 'AI', flowData: {} },
    });
  }

  async findOrCreate(conversationId: string) {
    const existing = await this.findActiveByConversationId(conversationId);
    if (existing) return existing;
    return this.create(conversationId);
  }

  async updateFlowData(sessionId: string, flowData: FlowData) {
    return this.prisma.session.update({
      where: { id: sessionId },
      data: { flowData: flowData as any },
    });
  }

  async close(sessionId: string, reason?: string) {
    return this.prisma.session.update({
      where: { id: sessionId },
      data: { endedAt: new Date(), reason },
    });
  }
}
