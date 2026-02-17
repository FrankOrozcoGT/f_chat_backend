export class UserCostDto {
  userId: string;
  userName: string;
  email: string;
  total: number;
  totalConversations: number;
  avgCostPerConversation: number;
}

export class DailyCostDto {
  date: string;
  total: number;
}

export class CostsResponseDto {
  totalSTT: number;
  totalLLM: number;
  totalTTS: number;
  total: number;
  byUser: UserCostDto[];
  byDay: DailyCostDto[];
}
