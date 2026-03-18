import { IsString, IsNumber, IsOptional, IsArray, Min } from 'class-validator';

export class CreatePromotionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  specialPrice: number;

  @IsArray()
  @IsString({ each: true })
  productIds: string[];
}
