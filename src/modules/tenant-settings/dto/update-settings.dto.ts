import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { AnalysisMode } from '@prisma/client';

export class UpdateSettingsDto {
  @IsOptional()
  @IsEnum(AnalysisMode)
  analysisMode?: AnalysisMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  messageLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultShippingCost?: number;

  @IsOptional()
  workSchedule?: object;
}
