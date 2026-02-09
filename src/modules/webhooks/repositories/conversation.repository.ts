import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ConversationRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * Crea o actualiza una conversación por phoneId y clientId
   * @param data - Datos de la conversación
   * @returns Conversación creada o actualizada
   */
  async upsert(data: { phoneId: string; clientId: string; isActive: boolean }) {
    return this.prisma.conversation.upsert({
      where: {
        phoneId_clientId: {
          phoneId: data.phoneId,
          clientId: data.clientId,
        },
      },
      create: {
        phoneId: data.phoneId,
        clientId: data.clientId,
        isActive: data.isActive,
      },
      update: {
        isActive: data.isActive,
      },
    });
  }

  /**
   * Actualiza el último mensaje de una conversación
   * @param conversationId - ID de la conversación
   * @param data - Datos de actualización
   */
  async updateLastMessage(
    conversationId: string,
    data: { lastMessageAt: Date; lastMessagePreview: string },
  ) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: data.lastMessageAt,
        lastMessagePreview: data.lastMessagePreview,
      },
    });
  }

  /**
   * Busca una conversación por ID
   * @param id - ID de la conversación
   * @returns Conversación o null
   */
  async findById(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
    });
  }
}
