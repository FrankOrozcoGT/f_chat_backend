import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateDiscountDto {
  @IsNumber()
  @Min(0)
  discountPrice: number;

  @IsOptional()
  @IsString()
  clientId?: string;
}
