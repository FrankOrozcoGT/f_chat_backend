import { IsString, IsBoolean, IsNumber, Min } from 'class-validator';

export class CreateShippingLocationDto {
  @IsString()
  name: string;

  @IsBoolean()
  isFreeShipping: boolean;

  @IsNumber()
  @Min(0)
  shippingCost: number;
}
