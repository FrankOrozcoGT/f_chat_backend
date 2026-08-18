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
      include: {
        analysis: {
          include: {
            conversation: {
              select: {
                groupJid: true,
                participants: {
                  select: {
                    clientId: true,
                    client: { select: { name: true, phoneNumber: true } },
                  },
                },
              },
            },
          },
        },
      },
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

  async findLinksWithAnalysisByFlowId(flowId: string) {
    return this.prisma.conversationAnalysisFlow.findMany({
      where: { flowId },
      select: {
        id: true,
        analysisId: true,
        analysis: { select: { conversationId: true, flowSummary: true, flowDiagram: true } },
      },
    });
  }

  /**
   * Mueve un link a otro flow si no existe ya un link para ese (analysisId, flowId);
   * si ya existe, elimina el link origen para no duplicar.
   */
  async moveLinkOrDelete(linkId: string, analysisId: string, targetFlowId: string) {
    const exists = await this.prisma.conversationAnalysisFlow.findUnique({
      where: { analysisId_flowId: { analysisId, flowId: targetFlowId } },
    });
    if (!exists) {
      await this.prisma.conversationAnalysisFlow.update({
        where: { id: linkId },
        data: { flowId: targetFlowId },
      });
    } else {
      await this.prisma.conversationAnalysisFlow.delete({ where: { id: linkId } });
    }
  }
}
