import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ConversationRepository {
  private readonly logger = new Logger(ConversationRepository.name);

  constructor(private prisma: PrismaService) {}

  async findByTenantIdAndPhone(
    tenantId: string,
    phoneId?: string,
    options?: { page?: number; limit?: number; search?: string },
  ) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const search = options?.search?.trim();

    const where = {
      isActive: true,
      phone: {
        tenantId,
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
          stats: true,
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
      phone: conv.phone,
      stats: conv.stats,
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

  async upsertIndividual(data: { phoneId: string; clientId: string; isActive: boolean }) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        phoneId: data.phoneId,
        type: 'individual',
        participants: { some: { clientId: data.clientId } },
      },
    });

    if (existing) {
      await this.upsertParticipant(existing.id, data.clientId);
      return this.prisma.conversation.update({
        where: { id: existing.id },
        data: { isActive: data.isActive },
      });
    }

    const created = await this.prisma.conversation.create({
      data: {
        phoneId: data.phoneId,
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

  async createManyIndividualWithParticipants(entries: { phoneId: string; clientId: string }[]) {
    if (entries.length === 0) return { count: 0 };

    const phoneId = entries[0].phoneId;
    const allClientIds = entries.map((e) => e.clientId);

    // Buscar cuáles ya existen via participants
    const existing = await this.prisma.conversation.findMany({
      where: {
        phoneId,
        type: 'individual',
        participants: { some: { clientId: { in: allClientIds } } },
      },
      include: { participants: { select: { clientId: true } } },
    });

    const existingClientIds = new Set(
      existing.flatMap((c) => c.participants.map((p) => p.clientId)),
    );

    const newEntries = entries.filter((e) => !existingClientIds.has(e.clientId));
    if (newEntries.length === 0) return { count: 0 };

    let count = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < newEntries.length; i += BATCH_SIZE) {
      const batch = newEntries.slice(i, i + BATCH_SIZE);
      await this.prisma.$transaction(async (tx) => {
        for (const entry of batch) {
          const conv = await tx.conversation.create({
            data: {
              phoneId: entry.phoneId,
              type: 'individual',
              isActive: true,
            },
          });
          await tx.conversationParticipant.create({
            data: {
              conversationId: conv.id,
              clientId: entry.clientId,
            },
          });
          count++;
        }
      });
    }

    return { count };
  }

  async findManyIndividualByPhoneAndClientIds(phoneId: string, clientIds: string[]) {
    return this.prisma.conversation.findMany({
      where: {
        phoneId,
        type: 'individual',
        participants: { some: { clientId: { in: clientIds } } },
      },
      include: {
        participants: { select: { clientId: true }, where: { clientId: { in: clientIds } } },
      },
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

  /**
   * Busca sub-conversaciones analizadas (isActive: false) del mismo phoneId + clientId
   */
  async findAnalyzedByPhoneAndClient(phoneId: string, clientId: string) {
    return this.prisma.conversation.findMany({
      where: {
        phoneId,
        isActive: false,
        participants: { some: { clientId } },
      },
      include: {
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findLastClosedByPhoneAndClient(phoneId: string, clientId: string) {
    return this.prisma.conversation.findFirst({
      where: {
        phoneId,
        isActive: false,
        participants: { some: { clientId } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  async updateSummary(conversationId: string, summary: string) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { summary },
    });
  }

  /**
   * Crea una conversación con su participant en una transacción
   */
  /**
   * Trae conversación + phone + client + messages en una sola query.
   * Uso exclusivo del endpoint GET /api/messages.
   */
  async findWithMessagesById(id: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        phone: true,
        participants: { include: { client: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conv) return null;
    return {
      ...conv,
      client: conv.participants[0]?.client ?? null,
    };
  }

  /**
   * Count de sub-conversaciones cerradas (mismo phoneId + clientId).
   * Se usa solo cuando messages.length === 0 para decidir si hacer fallback a Evolution.
   */
  async countClosedSubConversations(phoneId: string, clientId: string): Promise<number> {
    return this.prisma.conversation.count({
      where: {
        phoneId,
        isActive: false,
        participants: { some: { clientId } },
      },
    });
  }

  async upsertStats(conversationId: string, direction: 'inbound' | 'outbound', incrementUnread = false) {
    await this.prisma.conversationStats.upsert({
      where: { conversationId },
      create: {
        conversationId,
        lastMessageDirection: direction,
        unreadCount: incrementUnread ? 1 : 0,
      },
      update: {
        lastMessageDirection: direction,
        ...(incrementUnread && { unreadCount: { increment: 1 } }),
        ...(direction === 'outbound' && { unreadCount: 0 }),
      },
    });
  }

  async resetUnread(conversationId: string) {
    await this.prisma.conversationStats.updateMany({
      where: { conversationId },
      data: { unreadCount: 0 },
    });
  }

  async findAllGroupsSelect(tenantId: string) {
    return this.prisma.conversation.findMany({
      where: {
        type: 'group',
        groupJid: { not: null },
        phone: { tenantId },
      },
      select: { id: true, groupJid: true, groupName: true },
      orderBy: { groupName: 'asc' },
    });
  }

  async archiveMessages(
    phoneId: string,
    clientId: string,
    messageIds: string[],
    summary?: string,
  ): Promise<{ subConversationId: string; messageCount: number }> {
    const subConv = await this.createWithParticipant({ phoneId, clientId, summary, isActive: false });

    await this.prisma.message.updateMany({
      where: { id: { in: messageIds } },
      data: { conversationId: subConv.id, analyzedAt: new Date() },
    });

    return { subConversationId: subConv.id, messageCount: messageIds.length };
  }

  async createWithParticipant(data: {
    phoneId: string;
    clientId: string;
    summary?: string;
    isActive: boolean;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          phoneId: data.phoneId,
          type: 'individual',
          isActive: data.isActive,
          summary: data.summary,
        },
      });

      await tx.conversationParticipant.create({
        data: {
          conversationId: conversation.id,
          clientId: data.clientId,
        },
      });

      return conversation;
    });
  }

}
