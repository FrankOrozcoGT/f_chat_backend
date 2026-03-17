import { IsString, MinLength } from 'class-validator';

export class UpdateTenantDto {
  @IsString()
  @MinLength(1)
  name: string;
}
