import { IsEnum } from 'class-validator';

export enum CostPeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class CostsQueryDto {
  @IsEnum(CostPeriod, {
    message: 'period must be one of: day, week, month',
  })
  period: CostPeriod;
}
