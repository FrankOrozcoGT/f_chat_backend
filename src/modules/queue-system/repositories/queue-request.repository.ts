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

  async findPendingSent(instanceName: string, destinationPhone: string) {
    return this.prisma.queueRequest.findFirst({
      where: {
        instanceName,
        destinationPhone,
        status: 'sent',
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findPendingByDestination(destinationPhone: string) {
    return this.prisma.queueRequest.findFirst({
      where: {
        destinationPhone,
        status: 'sent',
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findPendingByGroup(groupJid: string) {
    return this.prisma.queueRequest.findFirst({
      where: {
        groupJid,
        status: 'sent',
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateStatus(id: string, status: QueueRequestStatus, extra?: { responseMessage?: string; sentAt?: Date; respondedAt?: Date }) {
    return this.prisma.queueRequest.update({
      where: { id },
      data: { status, ...extra },
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
