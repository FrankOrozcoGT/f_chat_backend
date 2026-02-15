import { IsString, IsNotEmpty } from 'class-validator';

export class TakeControlDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;
}
