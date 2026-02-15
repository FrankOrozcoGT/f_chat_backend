import { IsString, IsNotEmpty } from 'class-validator';

export class ReturnToAiDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;
}
