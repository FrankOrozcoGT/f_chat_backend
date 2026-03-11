import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class TestStartDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsString()
  @IsOptional()
  flowId?: string;

  @IsString()
  @IsNotEmpty()
  clientPhone: string;
}
