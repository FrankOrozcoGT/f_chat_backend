import { Injectable } from '@nestjs/common';
import {
  RawMessageStats,
  IntentStat,
  InternalChannel,
  DraftFlow,
  ConversationAnalysisSummary,
} from './repositories/dashboard.repository';

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
