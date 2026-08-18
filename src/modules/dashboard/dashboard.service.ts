import { Injectable } from '@nestjs/common';
import {
  RawMessageStats,
  IntentStat,
  InternalChannel,
  DraftFlow,
  ConversationAnalysisSummary,
  DashboardRepository,
} from './repositories/dashboard.repository';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

export interface DashboardMetrics {
  totalClients: number;
  totalActiveDays: number;
  totalMessages: number;
  avgDaysPerClient: number;
  avgMessagesPerActiveDay: number;
  intentStats: IntentStat[];
  internalChannels: InternalChannel[];
  draftFlows: DraftFlow[];
  conversationAnalyses: ConversationAnalysisSummary[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly dashboardRepository: DashboardRepository) {}

  async getDashboard(
    tenantId: string,
    fromParam: string | undefined,
    toParam: string | undefined,
  ): Promise<DashboardResponseDto> {
    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam
      ? new Date(fromParam)
      : new Date(new Date().setDate(to.getDate() - 30));

    // Asegurar que "to" incluya el fin del día
    to.setHours(23, 59, 59, 999);

    const [rawStats, intentStats, internalChannels, draftFlows, conversationAnalyses] =
      await Promise.all([
        this.dashboardRepository.getMessageStats(tenantId, from, to),
        this.dashboardRepository.getIntentStats(tenantId, from, to),
        this.dashboardRepository.getInternalChannels(tenantId),
        this.dashboardRepository.getDraftFlows(tenantId),
        this.dashboardRepository.getConversationAnalyses(tenantId, from, to),
      ]);

    const metrics = this.calculateMetrics(
      rawStats,
      intentStats,
      internalChannels,
      draftFlows,
      conversationAnalyses,
    );

    return new DashboardResponseDto({
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
      ...metrics,
    });
  }

  calculateMetrics(
    stats: RawMessageStats[],
    intentStats: IntentStat[],
    internalChannels: InternalChannel[],
    draftFlows: DraftFlow[],
    conversationAnalyses: ConversationAnalysisSummary[],
  ): DashboardMetrics {
    if (stats.length === 0) {
      return {
        totalClients: 0,
        totalActiveDays: 0,
        totalMessages: 0,
        avgDaysPerClient: 0,
        avgMessagesPerActiveDay: 0,
        intentStats,
        internalChannels,
        draftFlows,
        conversationAnalyses,
      };
    }

    const clientSet = new Set<string>();
    let totalActiveDays = 0;
    let totalMessages = 0;

    for (const row of stats) {
      clientSet.add(row.clientId);
      totalActiveDays += 1;
      totalMessages += row.messageCount;
    }

    const totalClients = clientSet.size;
    const avgDaysPerClient = totalClients > 0
      ? Math.round((totalActiveDays / totalClients) * 100) / 100
      : 0;
    const avgMessagesPerActiveDay = totalActiveDays > 0
      ? Math.round((totalMessages / totalActiveDays) * 100) / 100
      : 0;

    return {
      totalClients,
      totalActiveDays,
      totalMessages,
      avgDaysPerClient,
      avgMessagesPerActiveDay,
      intentStats,
      internalChannels,
      draftFlows,
      conversationAnalyses,
    };
  }
}
