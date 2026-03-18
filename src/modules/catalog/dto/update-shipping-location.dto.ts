import { IsString, IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateShippingLocationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isFreeShipping?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;
}
