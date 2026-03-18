import { IsString, IsNumber, IsOptional, IsArray, Min } from 'class-validator';

export class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  specialPrice?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}
