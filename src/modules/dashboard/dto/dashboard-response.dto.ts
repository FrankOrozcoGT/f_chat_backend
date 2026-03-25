import { IntentStat, InternalChannel, DraftFlow, ConversationAnalysisSummary } from '../repositories/dashboard.repository';

export class DashboardResponseDto {
  from: string;
  to: string;
  totalClients: number;
  totalActiveDays: number;
  totalMessages: number;
  avgDaysPerClient: number;
  avgMessagesPerActiveDay: number;
  intentStats: IntentStat[];
  internalChannels: InternalChannel[];
  draftFlows: DraftFlow[];
  conversationAnalyses: ConversationAnalysisSummary[];

  constructor(data: {
    from: string;
    to: string;
    totalClients: number;
    totalActiveDays: number;
    totalMessages: number;
    avgDaysPerClient: number;
    avgMessagesPerActiveDay: number;
    intentStats: IntentStat[];
    internalChannels: InternalChannel[];
    draftFlows: DraftFlow[];
    conversationAnalyses: ConversationAnalysisSummary[];
  }) {
    this.from = data.from;
    this.to = data.to;
    this.totalClients = data.totalClients;
    this.totalActiveDays = data.totalActiveDays;
    this.totalMessages = data.totalMessages;
    this.avgDaysPerClient = data.avgDaysPerClient;
    this.avgMessagesPerActiveDay = data.avgMessagesPerActiveDay;
    this.intentStats = data.intentStats;
    this.internalChannels = data.internalChannels;
    this.draftFlows = data.draftFlows;
    this.conversationAnalyses = data.conversationAnalyses;
  }
}
