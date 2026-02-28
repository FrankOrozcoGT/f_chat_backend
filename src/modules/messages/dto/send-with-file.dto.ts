import {
  IsUUID,
  IsNotEmpty,
  IsEnum,
  IsString,
  IsOptional,
} from 'class-validator';
import { MessageType } from '@prisma/client';

export class SendWithFileDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsEnum(MessageType)
  @IsNotEmpty()
  tipo: MessageType; // image, video, audio, document (NO text ni voice)

  @IsString()
  @IsOptional()
  contenido?: string; // Caption opcional
}
