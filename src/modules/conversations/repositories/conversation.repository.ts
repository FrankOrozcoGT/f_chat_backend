import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ConversationRepository {
  private readonly logger = new Logger(ConversationRepository.name);

  constructor(private prisma: PrismaService) {}

  async findByUserIdAndPhone(
    userId: string,
    phoneId?: string,
    options?: { page?: number; limit?: number; search?: string },
  ) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const search = options?.search?.trim();

    const where = {
      phone: {
        userId,
        ...(phoneId && { id: phoneId }),
      },
      ...(search && {
        OR: [
          {
            participants: {
              some: {
                client: {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' as const } },
                    {
                      phoneNumber: {
                        contains: search,
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              },
            },
          },
          { groupName: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [raw, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          phone: true,
          participants: { include: { client: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const data = raw.map((conv) => ({
      ...conv,
      client: conv.participants[0]?.client ?? null,
    }));

    return { data, total, page, limit };
  }

  async findById(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
    });
  }

  async findByIdWithRelations(id: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        phone: true,
        participants: { include: { client: true } },
      },
    });
    if (!conv) return null;
    return {
      ...conv,
      client: conv.participants[0]?.client ?? null,
    };
  }

  async createManySkipDuplicates(
    data: { phoneId: string; clientId: string }[],
  ) {
    return this.prisma.conversation.createMany({
      data: data.map((d) => ({
        phoneId: d.phoneId,
        clientId: d.clientId,
        isActive: true,
      })),
      skipDuplicates: true,
    });
  }

  async upsert(data: { phoneId: string; clientId: string; isActive: boolean }) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        phoneId: data.phoneId,
        clientId: data.clientId,
        type: 'individual',
      },
    });

    if (existing) {
      await this.prisma.conversationParticipant.upsert({
        where: {
          conversationId_clientId: {
            conversationId: existing.id,
            clientId: data.clientId,
          },
        },
        create: {
          conversationId: existing.id,
          clientId: data.clientId,
        },
        update: {},
      });
      return this.prisma.conversation.update({
        where: { id: existing.id },
        data: { isActive: data.isActive },
      });
    }

    const created = await this.prisma.conversation.create({
      data: {
        phoneId: data.phoneId,
        clientId: data.clientId,
        isActive: data.isActive,
        type: 'individual',
      },
    });

    await this.prisma.conversationParticipant.create({
      data: {
        conversationId: created.id,
        clientId: data.clientId,
      },
    });

    return created;
  }

  async findManyByPhoneIdAndClientIds(phoneId: string, clientIds: string[]) {
    return this.prisma.conversation.findMany({
      where: { phoneId, clientId: { in: clientIds }, type: 'individual' },
      select: { id: true, clientId: true },
    });
  }

  async createManyParticipantsSkipDuplicates(data: { conversationId: string; clientId: string }[]) {
    return this.prisma.conversationParticipant.createMany({ data, skipDuplicates: true });
  }

  async upsertParticipant(conversationId: string, clientId: string) {
    return this.prisma.conversationParticipant.upsert({
      where: { conversationId_clientId: { conversationId, clientId } },
      create: { conversationId, clientId },
      update: {},
    });
  }

  async updateMode(conversationId: string, mode: 'AI' | 'HITL') {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { mode },
    });
  }

  async updateLastMessage(
    conversationId: string,
    data: { lastMessageAt: Date; lastMessagePreview: string },
  ) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: data.lastMessageAt,
        lastMessagePreview: data.lastMessagePreview,
      },
    });
  }
}
