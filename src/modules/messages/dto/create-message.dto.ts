import { IsString, IsNotEmpty, IsUUID, IsEnum, IsUrl, IsOptional } from 'class-validator';
import { MessageType } from '@prisma/client';

export class CreateMessageDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsEnum(MessageType)
  @IsNotEmpty()
  tipo: MessageType;

  @IsString()
  @IsNotEmpty()
  contenido: string;

  @IsUrl()
  @IsOptional()
  mediaUrl?: string | null;

  @IsString()
  @IsOptional()
  quotedMessageId?: string;
}
