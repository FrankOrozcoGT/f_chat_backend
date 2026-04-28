import { IsString, IsOptional } from 'class-validator';

export class CreateLabelDto {
  @IsString()
  label: string;

  @IsString()
  clientId: string;

  @IsOptional()
  @IsString()
  groupJid?: string;
}
