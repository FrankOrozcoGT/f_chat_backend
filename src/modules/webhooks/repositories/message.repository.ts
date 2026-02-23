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
   * @param messageId - ID opcional del mensaje (para nombres de archivo estandarizados)
   * @returns Mensaje creado
   */
  async create(data: {
    conversationId: string;
    type: MessageType;
    content: string;
    mediaUrl: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    mimeType?: string | null;
    direction: MessageDirection;
    senderType: MessageSenderType;
    status: MessageStatus;
    metadata?: any;
    createdAt?: Date;
  }, messageId?: string) {
    return this.prisma.message.create({
      data: {
        id: messageId, // Prisma usará este ID si se proporciona, sino generará uno
        conversationId: data.conversationId,
        type: data.type,
        content: data.content,
        mediaUrl: data.mediaUrl,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        direction: data.direction,
        senderType: data.senderType,
        status: data.status,
        metadata: data.metadata,
        createdAt: data.createdAt,
      },
    });
  }

  /**
   * Operación atómica: Crea mensaje y actualiza conversación
   * Las validaciones (permisos, existencia) se hacen ANTES en el controller
   * @param conversationId - ID de la conversación
   * @param userId - ID del usuario (para referencia, validaciones ya hechas)
   * @param messageData - Datos del mensaje a crear
   * @param conversationUpdate - Datos para actualizar la conversación
   * @param messageId - ID opcional del mensaje (para nombres de archivo estandarizados)
   * @returns Mensaje creado
   */
  async sendMessageTransaction(
    conversationId: string,
    userId: string,
    messageData: {
      type: MessageType;
      content: string;
      mediaUrl: string | null;
      fileName?: string | null;
      fileSize?: number | null;
      mimeType?: string | null;
      direction: MessageDirection;
      senderType: MessageSenderType;
      status: MessageStatus;
      metadata?: any;
    },
    conversationUpdate: {
      lastMessageAt: Date;
      lastMessagePreview: string;
    },
    messageId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Crear mensaje con status 'pending' y metadata (keyId de Evolution)
      // Si se proporciona messageId, usarlo (para nombre de archivo estandarizado)
      const message = await tx.message.create({
        data: {
          id: messageId, // Prisma usará este ID si se proporciona, sino generará uno
          conversationId,
          type: messageData.type,
          content: messageData.content,
          mediaUrl: messageData.mediaUrl,
          fileName: messageData.fileName,
          fileSize: messageData.fileSize,
          mimeType: messageData.mimeType,
          direction: messageData.direction,
          senderType: messageData.senderType,
          status: messageData.status,
          metadata: messageData.metadata,
        },
      });

      // 2. Actualizar conversación
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: conversationUpdate.lastMessageAt,
          lastMessagePreview: conversationUpdate.lastMessagePreview,
        },
      });

      // Retornar solo el mensaje
      return { message };
    });
  }

  /**
   * Actualiza el status de un mensaje por su ID
   * @param messageId - ID del mensaje
   * @param status - Nuevo status
   * @returns Mensaje actualizado con conversationId incluido
   */
  async updateStatus(messageId: string, status: MessageStatus) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { status },
      select: {
        id: true,
        conversationId: true,
        status: true,
        content: true,
        type: true,
        direction: true,
        senderType: true,
        createdAt: true,
      },
    });
  }

  /**
   * Crea múltiples mensajes ignorando duplicados
   */
  async createMany(data: Array<{
    conversationId: string;
    type: MessageType;
    content: string;
    mediaUrl: string | null;
    direction: MessageDirection;
    senderType: MessageSenderType;
    status: MessageStatus;
    metadata?: any;
  }>) {
    return this.prisma.message.createMany({ data });
  }

  /**
   * Retorna los keyIds (metadata.keyId) existentes de una conversación
   * @param conversationId - ID de la conversación
   * @returns Set de keyIds ya persistidos
   */
  async findKeyIdsByConversationId(conversationId: string): Promise<Set<string>> {
    const results = await this.prisma.$queryRaw<Array<{ keyId: string }>>`
      SELECT metadata->>'keyId' as "keyId"
      FROM "Message"
      WHERE "conversationId" = ${conversationId}
        AND metadata->>'keyId' IS NOT NULL
    `;
    return new Set(results.map((r) => r.keyId));
  }

  /**
   * Busca un mensaje por keyId en metadata
   * @param keyId - ID del mensaje en Evolution API (guardado en metadata.keyId)
   * @returns Mensaje completo o null si no se encuentra
   */
  async findByMetadataKeyId(keyId: string) {
    const result = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Message"
      WHERE metadata->>'keyId' = ${keyId}
      LIMIT 1
    `;

    if (!result || result.length === 0) {
      return null;
    }

    return this.prisma.message.findUnique({ where: { id: result[0].id } });
  }

  /**
   * Busca mensaje por keyId en metadata y actualiza su status
   * @param keyId - ID del mensaje en Evolution API (guardado en metadata.keyId)
   * @param status - Nuevo status
   * @returns Mensaje actualizado o null si no se encuentra
   */
  async updateStatusByKeyId(keyId: string, status: MessageStatus) {
    // Buscar mensaje cuyo metadata->>'keyId' coincida usando raw query
    const message = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Message"
      WHERE metadata->>'keyId' = ${keyId}
      LIMIT 1
    `;

    if (!message || message.length === 0) {
      return null;
    }

    // Actualizar status
    return this.prisma.message.update({
      where: { id: message[0].id },
      data: { status },
      select: {
        id: true,
        conversationId: true,
        status: true,
        content: true,
        type: true,
        direction: true,
        senderType: true,
        createdAt: true,
      },
    });
  }

  /**
   * Busca el mensaje saliente más reciente con status 'pending' de un phoneId
   * y actualiza su status
   * @param phoneId - ID del phone
   * @param newStatus - Nuevo status
   * @returns Mensaje actualizado o null si no se encuentra
   */
  async updateLatestPendingOutgoingMessage(phoneId: string, newStatus: MessageStatus) {
    // Buscar el mensaje más reciente con status 'pending' y direction 'outgoing'
    const latestPendingMessage = await this.prisma.message.findFirst({
      where: {
        conversation: {
          phoneId: phoneId,
        },
        direction: 'outgoing',
        status: 'pending',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!latestPendingMessage) {
      return null;
    }

    // Actualizar el status
    return this.prisma.message.update({
      where: { id: latestPendingMessage.id },
      data: { status: newStatus },
      select: {
        id: true,
        conversationId: true,
        status: true,
        content: true,
        type: true,
        direction: true,
        senderType: true,
        createdAt: true,
      },
    });
  }
}
