import { IsString, IsOptional } from 'class-validator';

export class CreateIntentDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  flowId?: string;
}
