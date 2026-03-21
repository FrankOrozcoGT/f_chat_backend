export class DashboardResponseDto {
  from: string;
  to: string;
  totalClients: number;
  totalActiveDays: number;
  totalMessages: number;
  avgDaysPerClient: number;
  avgMessagesPerActiveDay: number;

  constructor(data: {
    from: string;
    to: string;
    totalClients: number;
    totalActiveDays: number;
    totalMessages: number;
    avgDaysPerClient: number;
    avgMessagesPerActiveDay: number;
  }) {
    this.from = data.from;
    this.to = data.to;
    this.totalClients = data.totalClients;
    this.totalActiveDays = data.totalActiveDays;
    this.totalMessages = data.totalMessages;
    this.avgDaysPerClient = data.avgDaysPerClient;
    this.avgMessagesPerActiveDay = data.avgMessagesPerActiveDay;
  }
}
