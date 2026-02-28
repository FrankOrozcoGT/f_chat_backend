import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { AnalysisMode } from '@prisma/client';

export class UpdateSettingsDto {
  @IsOptional()
  @IsEnum(AnalysisMode)
  analysisMode?: AnalysisMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  messageLimit?: number;
}
