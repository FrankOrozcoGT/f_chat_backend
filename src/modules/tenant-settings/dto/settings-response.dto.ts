import { AnalysisMode } from '@prisma/client';

export class SettingsResponseDto {
  id: string;
  tenantId: string;
  analysisMode: AnalysisMode;
  messageLimit: number;
  defaultShippingCost: number;
  workSchedule: unknown;
  createdAt: Date;
  updatedAt: Date;

  constructor(data: {
    id: string;
    tenantId: string;
    analysisMode: AnalysisMode;
    messageLimit: number;
    defaultShippingCost: number;
    workSchedule: unknown;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = data.id;
    this.tenantId = data.tenantId;
    this.analysisMode = data.analysisMode;
    this.messageLimit = data.messageLimit;
    this.defaultShippingCost = data.defaultShippingCost;
    this.workSchedule = data.workSchedule;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }
}
