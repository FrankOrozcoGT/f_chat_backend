import { IsEnum, IsInt, IsNumber, IsOptional, Min, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalysisMode } from '@prisma/client';

export class WorkDayScheduleDto {
  @IsNumber()
  @Min(0)
  start: number;

  @IsNumber()
  @Min(0)
  end: number;
}

export class WorkScheduleDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkDayScheduleDto)
  '1'?: WorkDayScheduleDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkDayScheduleDto)
  '2'?: WorkDayScheduleDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkDayScheduleDto)
  '3'?: WorkDayScheduleDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkDayScheduleDto)
  '4'?: WorkDayScheduleDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkDayScheduleDto)
  '5'?: WorkDayScheduleDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkDayScheduleDto)
  '6'?: WorkDayScheduleDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkDayScheduleDto)
  '7'?: WorkDayScheduleDto;
}

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
  @IsObject()
  @ValidateNested()
  @Type(() => WorkScheduleDto)
  workSchedule?: WorkScheduleDto;
}
