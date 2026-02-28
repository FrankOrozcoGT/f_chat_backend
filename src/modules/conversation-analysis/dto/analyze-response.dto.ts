export class AnalyzeResponseDto {
  conversations: Array<{
    id: string;
    summary: string;
    isActive: boolean;
    messageCount: number;
  }>;
  creditsUsed: number;
  warnings: Array<{
    messageId: string;
    type: string;
    message: string;
  }>;

  constructor(data: AnalyzeResponseDto) {
    this.conversations = data.conversations;
    this.creditsUsed = data.creditsUsed;
    this.warnings = data.warnings;
  }
}
