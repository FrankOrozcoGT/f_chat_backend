import { IsString, IsNotEmpty } from 'class-validator';

export class TestStartDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  flowId: string;

  @IsString()
  @IsNotEmpty()
  clientPhone: string;
}
