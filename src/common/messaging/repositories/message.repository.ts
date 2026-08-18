import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  MessageType,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { MessageMetadata, parseMessageMetadata } from '../types/message-metadata';

@Injectable()
export class MessageRepository {
  // Repository para mensajes
  constructor(private prisma: PrismaService) {}

  /**
   * Últimos N mensajes de una conversación, orden descendente (más reciente primero).
   */
  async findRecentByConversationId(
    conversationId: string,
    take: number,
  ): Promise<{ content: string; direction: MessageDirection; senderType: MessageSenderType; createdAt: Date; metadata: MessageMetadata | null }[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { content: true, direction: true, senderType: true, createdAt: true, metadata: true },
    });
    return rows.map((r) => ({ ...r, metadata: parseMessageMetadata(r.metadata) }));
  }

  /**
   * Últimos N mensajes entre varias conversaciones individuales del mismo cliente,
   * orden descendente (más reciente primero).
   */
  async findRecentByConversationIds(conversationIds: string[], take: number) {
    return this.prisma.message.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: 'desc' },
      take,
      select: { content: true, direction: true, senderType: true, createdAt: true },
    });
  }

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
  async create(
    data: {
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
      metadata?: Prisma.InputJsonValue | null;
      createdAt?: Date;
    },
    messageId?: string,
  ) {
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
        metadata: data.metadata === null ? Prisma.JsonNull : data.metadata,
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
      metadata?: Prisma.InputJsonValue | null;
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
          metadata: messageData.metadata === null ? Prisma.JsonNull : messageData.metadata,
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
  async createMany(
    data: Array<{
      conversationId: string;
      type: MessageType;
      content: string;
      mediaUrl: string | null;
      direction: MessageDirection;
      senderType: MessageSenderType;
      status: MessageStatus;
      metadata?: Prisma.InputJsonValue | null;
    }>,
  ) {
    return this.prisma.message.createMany({
      data: data.map((d) => ({
        ...d,
        metadata: d.metadata === null ? Prisma.JsonNull : d.metadata,
      })),
    });
  }

  /**
   * Bulk insert mensajes con todos los campos, skipDuplicates por keyId no soportado en Prisma
   * Se filtra externamente antes de llamar
   */
  async createManyFull(
    data: Array<{
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
      metadata?: Prisma.InputJsonValue | null;
      createdAt?: Date;
    }>,
  ) {
    return this.prisma.message.createMany({
      data: data.map((d) => ({
        ...d,
        metadata: d.metadata === null ? Prisma.JsonNull : d.metadata,
      })),
      skipDuplicates: true,
    });
  }

  async countByConversationId(conversationId: string): Promise<number> {
    return this.prisma.message.count({ where: { conversationId } });
  }

  /**
   * Retorna los keyIds (metadata.keyId) existentes de una conversación
   * @param conversationId - ID de la conversación
   * @returns Set de keyIds ya persistidos
   */
  async findKeyIdsByConversationId(
    conversationId: string,
  ): Promise<Set<string>> {
    const results = await this.prisma.$queryRaw<Array<{ keyId: string }>>`
      SELECT metadata->>'keyId' as "keyId"
      FROM "Message"
      WHERE "conversationId" = ${conversationId}
        AND metadata->>'keyId' IS NOT NULL
    `;
    return new Set(results.map((r) => r.keyId));
  }

  /**
   * Busca un mensaje por su id de DB
   */
  async findById(id: string) {
    return this.prisma.message.findUnique({ where: { id } });
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
  /**
   * Obtiene los últimos N mensajes no analizados de una conversación
   */
  async findLastNUnanalyzed(conversationId: string, limit: number) {
    // Traer los N más recientes no analizados (desc) y luego reordenar asc para la IA
    const newest = await this.prisma.message.findMany({
      where: { conversationId, analyzedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return newest.reverse();
  }

  /**
   * Marca mensajes como analizados
   */
  async markAsAnalyzed(messageIds: string[]) {
    return this.prisma.message.updateMany({
      where: { id: { in: messageIds } },
      data: { analyzedAt: new Date() },
    });
  }

  /**
   * Cuenta mensajes no analizados de una conversación
   */
  async countUnanalyzed(conversationId: string): Promise<number> {
    return this.prisma.message.count({
      where: { conversationId, analyzedAt: null },
    });
  }

  /**
   * Obtiene los mensajes no analizados que NO están en el batch enviado a la IA.
   * Son los mensajes más antiguos que quedaron fuera del límite.
   */
  async findRemainingUnanalyzed(
    conversationId: string,
    excludeIds: string[],
  ) {
    return this.prisma.message.findMany({
      where: {
        conversationId,
        analyzedAt: null,
        id: { notIn: excludeIds },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Guarda la transcripción de un mensaje de audio
   */
  async updateTranscription(messageId: string, transcription: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { transcription },
    });
  }

  /**
   * Mueve mensajes a otra conversación (update conversationId)
   */
  async updateConversationId(messageIds: string[], newConversationId: string) {
    return this.prisma.message.updateMany({
      where: { id: { in: messageIds } },
      data: { conversationId: newConversationId },
    });
  }

  async updateLatestPendingOutgoingMessage(
    phoneId: string,
    newStatus: MessageStatus,
  ) {
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
