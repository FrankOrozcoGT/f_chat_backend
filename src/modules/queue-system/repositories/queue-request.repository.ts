import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { QueueRequestStatus } from '@prisma/client';

@Injectable()
export class QueueRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    nodeSessionId: string;
    conversationId: string;
    currentNodeId: string;
    instanceName: string;
    label: string;
    destinationPhone: string;
    groupJid?: string | null;
    outgoingMessage: string;
    imageUrl?: string | null;
    isTest?: boolean;
    toolName: string;
    toolContext?: any;
  }) {
    return this.prisma.queueRequest.create({ data });
  }

  async findById(id: string) {
    return this.prisma.queueRequest.findUnique({ where: { id } });
  }

  async findBySentWhatsappMessageId(messageId: string) {
    return this.prisma.queueRequest.findFirst({
      where: { sentWhatsappMessageId: messageId, status: 'sent' },
    });
  }

  async updateStatus(id: string, status: QueueRequestStatus, extra?: { responseMessage?: string; sentWhatsappMessageId?: string; sentAt?: Date; respondedAt?: Date }) {
    return this.prisma.queueRequest.update({
      where: { id },
      data: { status, ...extra },
    });
  }

  async cancelByConversationId(conversationId: string) {
    return this.prisma.queueRequest.updateMany({
      where: { conversationId, status: { in: ['pending', 'sent'] } },
      data: { status: 'cancelled' },
    });
  }

  async findExpiredSent(olderThanHours: number) {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    return this.prisma.queueRequest.findMany({
      where: {
        status: 'sent',
        sentAt: { lt: cutoff },
      },
    });
  }
}
