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
