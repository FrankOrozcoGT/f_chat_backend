import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ConversationRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * Lista conversaciones por userId y opcionalmente por phoneId
   * @param userId - ID del usuario
   * @param phoneId - ID del teléfono (opcional)
   * @returns Lista de conversaciones con datos de client y phone
   */
  async findByUserIdAndPhone(
    userId: string,
    phoneId?: string,
    options?: { page?: number; limit?: number; search?: string },
  ) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const search = options?.search?.trim();

    const where = {
      phone: {
        userId,
        ...(phoneId && { id: phoneId }),
      },
      ...(search && {
        client: {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { phoneNumber: { contains: search, mode: 'insensitive' as const } },
          ],
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: { client: true, phone: true },
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { data, total, page, limit };
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

  /**
   * Busca una conversación por ID con relaciones (phone y client)
   * @param id - ID de la conversación
   * @returns Conversación con phone y client o null
   */
  async findByIdWithRelations(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        phone: true,
        client: true,
      },
    });
  }

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
  async updateMode(conversationId: string, mode: 'AI' | 'HITL') {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { mode },
    });
  }

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
}
