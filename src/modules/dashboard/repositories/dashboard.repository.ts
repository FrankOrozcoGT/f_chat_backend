import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

export interface RawMessageStats {
  clientId: string;
  activeDay: string;
  messageCount: number;
}

export interface IntentStat {
  intent: string;
  count: number;
}

export interface InternalChannel {
  label: string;
  purpose: string | null;
  status: string;
}

export interface DraftFlow {
  flowId: string;
  flowName: string;
  isPromoted: boolean;
  versionCount: number;
  analysisIds: string[];
}

export interface ConversationAnalysisSummary {
  conversationId: string;
  intent: string | null;
  flowSummary: string | null;
  flowDiagram: string | null;
  isInternal: boolean | null;
  internalPurpose: string | null;
  analyzedAt: Date | null;
}

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getMessageStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<RawMessageStats[]> {
    const result = await this.prisma.$queryRaw<RawMessageStats[]>`
      SELECT
        cp."clientId",
        DATE(m."createdAt") AS "activeDay",
        COUNT(m.id)::int     AS "messageCount"
      FROM "Message" m
      INNER JOIN "Conversation" c  ON c.id = m."conversationId"
      INNER JOIN "Phone" p         ON p.id = c."phoneId"
      INNER JOIN "ConversationParticipant" cp ON cp."conversationId" = c.id
      WHERE
        p."tenantId" = ${tenantId}
        AND m."createdAt" >= ${from}
        AND m."createdAt" <= ${to}
      GROUP BY cp."clientId", DATE(m."createdAt")
      ORDER BY cp."clientId", "activeDay"
    `;

    return result;
  }

  async getIntentStats(tenantId: string, from: Date, to: Date): Promise<IntentStat[]> {
    const result = await this.prisma.$queryRaw<IntentStat[]>`
      SELECT
        ca."intent",
        COUNT(ca.id)::int AS "count"
      FROM "ConversationAnalysis" ca
      INNER JOIN "Conversation" c ON c.id = ca."conversationId"
      INNER JOIN "Phone" p ON p.id = c."phoneId"
      WHERE
        p."tenantId" = ${tenantId}
        AND ca."intent" IS NOT NULL
        AND ca."analyzedAt" >= ${from}
        AND ca."analyzedAt" <= ${to}
      GROUP BY ca."intent"
      ORDER BY "count" DESC
    `;
    return result;
  }

  async getInternalChannels(tenantId: string): Promise<InternalChannel[]> {
    const labels = await this.prisma.contactLabel.findMany({
      where: { tenantId, status: { in: ['draft', 'active'] } },
      select: { label: true, status: true },
    });
    return labels.map((l) => ({
      label: l.label,
      purpose: null,
      status: l.status,
    }));
  }

  async getDraftFlows(tenantId: string): Promise<DraftFlow[]> {
    const flows = await this.prisma.flow.findMany({
      where: { tenantId, status: 'draft' },
      select: { id: true, name: true },
    });

    if (flows.length === 0) return [];

    const flowIds = flows.map((f) => f.id);

    const [versions, analysisFlows] = await Promise.all([
      this.prisma.flowVersion.findMany({
        where: { flowId: { in: flowIds } },
        select: { flowId: true, isPromoted: true },
      }),
      this.prisma.conversationAnalysisFlow.findMany({
        where: { flowId: { in: flowIds } },
        select: { flowId: true, analysisId: true },
      }),
    ]);

    return flows.map((f) => {
      const flowVersions = versions.filter((v) => v.flowId === f.id);
      const flowAnalyses = analysisFlows.filter((a) => a.flowId === f.id);
      return {
        flowId: f.id,
        flowName: f.name,
        isPromoted: flowVersions.some((v) => v.isPromoted),
        versionCount: flowVersions.length,
        analysisIds: flowAnalyses.map((a) => a.analysisId),
      };
    });
  }

  async getConversationAnalyses(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<ConversationAnalysisSummary[]> {
    return this.prisma.conversationAnalysis.findMany({
      where: {
        conversation: { phone: { tenantId } },
        analyzedAt: { gte: from, lte: to },
      },
      select: {
        conversationId: true,
        intent: true,
        flowSummary: true,
        flowDiagram: true,
        isInternal: true,
        internalPurpose: true,
        analyzedAt: true,
      },
      orderBy: { analyzedAt: 'desc' },
    });
  }
}
