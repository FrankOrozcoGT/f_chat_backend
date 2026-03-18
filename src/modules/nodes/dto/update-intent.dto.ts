import { IsString, IsOptional } from 'class-validator';

export class UpdateIntentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  flowId?: string;
}
