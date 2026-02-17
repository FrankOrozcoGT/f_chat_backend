import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateUserLimitsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  whatsappLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  creditsLimit?: number;
}
