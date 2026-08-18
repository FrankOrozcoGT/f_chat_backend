import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ConversationAnalysisRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: {
    conversationId: string;
    intent: string | null;
    intentDescription: string | null;
    flowDiagram: string | null;
    flowSummary: string | null;
    isInternal?: boolean;
    internalPurpose?: string | null;
  }) {
    return this.prisma.conversationAnalysis.upsert({
      where: { conversationId: data.conversationId },
      create: {
        conversationId: data.conversationId,
        intent: data.intent,
        intentDescription: data.intentDescription,
        flowDiagram: data.flowDiagram,
        flowSummary: data.flowSummary,
        isInternal: data.isInternal ?? false,
        internalPurpose: data.internalPurpose ?? null,
      },
      update: {
        intent: data.intent,
        intentDescription: data.intentDescription,
        flowDiagram: data.flowDiagram,
        flowSummary: data.flowSummary,
        isInternal: data.isInternal ?? false,
        internalPurpose: data.internalPurpose ?? null,
        analyzedAt: new Date(),
      },
    });
  }

  async upsertInternal(data: {
    conversationId: string;
    isInternal: boolean;
    internalPurpose: string | null;
  }) {
    return this.prisma.conversationAnalysis.upsert({
      where: { conversationId: data.conversationId },
      create: {
        conversationId: data.conversationId,
        intent: null,
        flowDiagram: null,
        flowSummary: null,
        isInternal: data.isInternal,
        internalPurpose: data.internalPurpose,
      },
      update: {
        isInternal: data.isInternal,
        internalPurpose: data.internalPurpose,
        analyzedAt: new Date(),
      },
    });
  }

  async markAllAsInternalByClient(clientId: string, internalPurpose: string) {
    await this.prisma.conversationAnalysis.updateMany({
      where: { conversation: { participants: { some: { clientId } } } },
      data: { isInternal: true, internalPurpose },
    });
  }

  async markAllAsInternalByGroup(groupJid: string, internalPurpose: string) {
    await this.prisma.conversationAnalysis.updateMany({
      where: { conversation: { groupJid } },
      data: { isInternal: true, internalPurpose },
    });
  }

  async findByConversationId(conversationId: string) {
    return this.prisma.conversationAnalysis.findUnique({
      where: { conversationId },
    });
  }

  async renameIntent(fromIntent: string, toIntent: string, tenantId: string) {
    return this.prisma.conversationAnalysis.updateMany({
      where: {
        intent: fromIntent,
        conversation: { phone: { tenantId } },
      },
      data: { intent: toIntent },
    });
  }

  /**
   * Conversaciones de un cliente con sus últimos N mensajes y análisis, para
   * la pantalla de revisión de canal interno.
   */
  async findClientConversationsWithMessages(clientId: string, messageLimit: number) {
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { clientId } } },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        groupJid: true,
        isActive: true,
        lastMessageAt: true,
      },
    });

    const conversationIds = conversations.map((c) => c.id);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: 'desc' },
      take: messageLimit,
      select: {
        id: true,
        conversationId: true,
        content: true,
        transcription: true,
        direction: true,
        type: true,
        createdAt: true,
      },
    });

    const analysis = await this.prisma.conversationAnalysis.findMany({
      where: { conversationId: { in: conversationIds } },
      select: {
        conversationId: true,
        isInternal: true,
        internalPurpose: true,
        intent: true,
      },
    });

    const analysisMap = new Map(analysis.map((a) => [a.conversationId, a]));

    return conversations.map((c) => ({
      ...c,
      analysis: analysisMap.get(c.id) ?? null,
      messages: messages.filter((m) => m.conversationId === c.id).reverse(),
    }));
  }

  async findAllByTenantId(tenantId: string, excludeInternalReviews = true) {
    let excludedClientIds: string[] = [];

    if (excludeInternalReviews) {
      const reviews = await this.prisma.internalChannelReview.findMany({
        where: { tenantId, status: { not: 'rejected' } },
        select: { clientId: true },
      });
      excludedClientIds = reviews.map((r) => r.clientId).filter((id): id is string => !!id);
    }

    return this.prisma.conversationAnalysis.findMany({
      where: {
        conversation: {
          phone: { tenantId },
          ...(excludedClientIds.length > 0
            ? { participants: { none: { clientId: { in: excludedClientIds } } } }
            : {}),
        },
        isInternal: false,
        intent: { not: null },
        OR: [
          { flowSummary: { not: null } },
          { flowDiagram: { not: null } },
        ],
      },
      select: {
        id: true,
        conversationId: true,
        intent: true,
        intentDescription: true,
        flowDiagram: true,
        flowSummary: true,
        isInternal: true,
        internalPurpose: true,
      },
    });
  }
}
