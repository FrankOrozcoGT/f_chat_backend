import { AnalysisMode } from '@prisma/client';

export class SettingsResponseDto {
  id: string;
  userId: string;
  analysisMode: AnalysisMode;
  messageLimit: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(data: {
    id: string;
    userId: string;
    analysisMode: AnalysisMode;
    messageLimit: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = data.id;
    this.userId = data.userId;
    this.analysisMode = data.analysisMode;
    this.messageLimit = data.messageLimit;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }
}
