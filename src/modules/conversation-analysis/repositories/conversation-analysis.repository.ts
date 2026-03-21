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
  }) {
    return this.prisma.conversationAnalysis.upsert({
      where: { conversationId: data.conversationId },
      create: {
        conversationId: data.conversationId,
        intent: data.intent,
        flowDiagram: data.flowDiagram,
        flowSummary: data.flowSummary,
      },
      update: {
        intent: data.intent,
        flowDiagram: data.flowDiagram,
        flowSummary: data.flowSummary,
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
