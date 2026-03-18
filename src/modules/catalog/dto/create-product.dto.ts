import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  basePrice: number;

  @IsOptional()
  @IsString()
  description?: string;
}
