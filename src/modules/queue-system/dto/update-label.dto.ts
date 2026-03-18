import { IsString, IsOptional } from 'class-validator';

export class UpdateLabelDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  groupJid?: string;
}
