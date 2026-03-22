import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ConversationAnalysisRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: {
    conversationId: string;
    intent: string | null;
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
        flowDiagram: data.flowDiagram,
        flowSummary: data.flowSummary,
        isInternal: data.isInternal ?? false,
        internalPurpose: data.internalPurpose ?? null,
      },
      update: {
        intent: data.intent,
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

  async findByConversationId(conversationId: string) {
    return this.prisma.conversationAnalysis.findUnique({
      where: { conversationId },
    });
  }
}
