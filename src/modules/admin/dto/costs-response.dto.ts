export class TenantCostDto {
  tenantId: string;
  tenantName: string;
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
  byTenant: TenantCostDto[];
  byDay: DailyCostDto[];
}
