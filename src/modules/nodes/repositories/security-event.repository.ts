import { Injectable } from '@nestjs/common';
import { SecurityEventType } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class SecurityEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    type: SecurityEventType;
    userId: string;
    conversationId?: string;
    clientPhone?: string;
    description: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.securityEvent.create({ data });
  }

  async findByUserId(userId: string) {
    return this.prisma.securityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll() {
    return this.prisma.securityEvent.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
