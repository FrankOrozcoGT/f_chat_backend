import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class FlowIntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async linkAnalysesToFlow(analysisIds: string[], flowId: string) {
    return this.prisma.conversationAnalysisFlow.createMany({
      data: analysisIds.map((analysisId) => ({ analysisId, flowId })),
      skipDuplicates: true,
    });
  }

  async findByFlowId(flowId: string) {
    return this.prisma.conversationAnalysisFlow.findMany({
      where: { flowId },
      include: { analysis: true },
    });
  }

  async deleteInternalByFlowId(flowId: string) {
    return this.prisma.conversationAnalysisFlow.deleteMany({
      where: {
        flowId,
        analysis: { isInternal: true },
      },
    });
  }
}
