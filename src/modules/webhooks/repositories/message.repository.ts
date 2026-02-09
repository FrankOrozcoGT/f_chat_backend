import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { MessageType, MessageDirection, MessageSenderType, MessageStatus } from '@prisma/client';

@Injectable()
export class MessageRepository {
  // Repository para mensajes
  constructor(private prisma: PrismaService) {}

  /**
   * Crea un nuevo mensaje
   * @param data - Datos del mensaje
   * @returns Mensaje creado
   */
  async create(data: {
    conversationId: string;
    type: MessageType;
    content: string;
    mediaUrl: string | null;
    direction: MessageDirection;
    senderType: MessageSenderType;
    status: MessageStatus;
  }) {
    return this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        type: data.type,
        content: data.content,
        mediaUrl: data.mediaUrl,
        direction: data.direction,
        senderType: data.senderType,
        status: data.status,
      },
    });
  }
}
