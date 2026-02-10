import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { MessageType, MessageDirection, MessageSenderType, MessageStatus } from '@prisma/client';

@Injectable()
export class MessageRepository {
  // Repository para mensajes
  constructor(private prisma: PrismaService) {}

  /**
   * Lista mensajes de una conversación
   * @param conversationId - ID de la conversación
   * @returns Mensajes ordenados cronológicamente
   */
  async findByConversationId(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

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

  /**
   * Actualiza un mensaje existente
   * @param id - ID del mensaje
   * @param data - Datos a actualizar
   * @returns Mensaje actualizado
   */
  async update(
    id: string,
    data: {
      mediaUrl?: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
    },
  ) {
    return this.prisma.message.update({
      where: { id },
      data,
    });
  }
}
