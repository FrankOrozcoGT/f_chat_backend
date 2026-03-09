import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ContactRepository {
  constructor(private prisma: PrismaService) {}

  async searchWithConversations(userId: string, search: string) {
    return this.prisma.client.findMany({
      where: {
        participations: {
          some: {
            conversation: {
              phone: { userId },
            },
          },
        },
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phoneNumber: { contains: search, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        participations: {
          where: {
            conversation: {
              phone: { userId },
            },
          },
          select: {
            conversation: {
              select: {
                id: true,
                isActive: true,
                lastMessagePreview: true,
                summary: true,
                updatedAt: true,
              },
            },
          },
          orderBy: {
            conversation: { updatedAt: 'desc' },
          },
        },
      },
    });
  }
}
