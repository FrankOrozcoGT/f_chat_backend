import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Conversation,
  Phone,
  Message,
  MessageType,
  MessageStatus,
} from '@prisma/client';

@Injectable()
export class MessagesService {
  constructor(private readonly configService: ConfigService) {}
  /**
   * Valida que el usuario sea dueño de la conversación (vía phone)
   * @param conversation - Conversación a validar
   * @param phone - Teléfono asociado a la conversación
   * @param userId - ID del usuario autenticado
   * @throws ForbiddenException si el usuario no es dueño
   */
  checkUserOwnsConversation(
    conversation: Conversation,
    phone: Phone,
    userId: string,
  ): void {
    if (phone.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to access this conversation',
      );
    }
  }

  /**
   * Construye URLs completas para los mediaUrl de los mensajes
   * @param messages - Lista de mensajes con mediaUrl relativos
   * @returns Mensajes con mediaUrl completos (con dominio)
   */
  buildMessagesWithFullUrls(messages: Message[]): Message[] {
    const backendUrl = this.configService.get<string>('BACKEND_URL');

    return messages.map((message) => ({
      ...message,
      mediaUrl: message.mediaUrl ? `${backendUrl}${message.mediaUrl}` : null,
    }));
  }

  /**
   * Valida que el contenido del mensaje sea válido según su tipo
   * @param type - Tipo de mensaje
   * @param content - Contenido del mensaje
   * @throws BadRequestException si el contenido no es válido
   */
  validateMessageContent(type: MessageType, content: string): void {
    // Para mensajes multimedia, el contenido puede estar vacío (solo caption)
    if (type === 'text') {
      if (!content || content.trim().length === 0) {
        throw new BadRequestException('Text message content cannot be empty');
      }

      if (content.length > 4096) {
        throw new BadRequestException(
          'Text message exceeds maximum length of 4096 characters',
        );
      }
    }

    // Para multimedia (image, video, audio, voice, document), el contenido es opcional (caption)
    if (content && content.length > 1024) {
      throw new BadRequestException(
        'Media caption exceeds maximum length of 1024 characters',
      );
    }
  }

  /**
   * Construye los datos de un mensaje saliente (outgoing)
   * @param conversationId - ID de la conversación
   * @param type - Tipo de mensaje
   * @param content - Contenido del mensaje
   * @param status - Estado del mensaje
   * @param mediaUrl - URL del archivo multimedia (opcional)
   * @param evolutionKeyId - ID del mensaje en Evolution API (para tracking en webhooks)
   * @param fileName - Nombre original del archivo (opcional)
   * @param fileSize - Tamaño del archivo en bytes (opcional)
   * @param mimeType - Tipo MIME del archivo (opcional)
   * @returns Datos para crear el mensaje
   */
  buildOutgoingMessageData(
    conversationId: string,
    type: MessageType,
    content: string,
    status: MessageStatus,
    mediaUrl?: string | null,
    evolutionKeyId?: string,
    fileName?: string | null,
    fileSize?: number | null,
    mimeType?: string | null,
    senderType: 'agent' | 'bot' | 'system' = 'agent',
    quotedMessageId?: string,
  ) {
    const metadata: Record<string, any> = {};
    if (evolutionKeyId) metadata.keyId = evolutionKeyId;
    if (quotedMessageId) metadata.quotedMessageId = quotedMessageId;

    return {
      conversationId,
      type,
      content,
      mediaUrl: mediaUrl || null,
      fileName: fileName || null,
      fileSize: fileSize || null,
      mimeType: mimeType || null,
      direction: 'outgoing' as const,
      senderType,
      status,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    };
  }

  /**
   * Construye los datos de actualización de la conversación
   * @param message - Mensaje creado
   * @returns Datos para actualizar la conversación
   */
  buildConversationUpdate(message: Message) {
    return {
      lastMessageAt: message.createdAt,
      lastMessagePreview: message.content.substring(0, 100),
    };
  }

  resolveRemoteJid(conversation: { type: string; groupJid?: string | null; client?: { phoneNumber: string } | null }, conversationId: string): string {
    const isGroup = conversation.type === 'group';
    const remoteJid = isGroup
      ? conversation.groupJid
      : conversation.client ? `${conversation.client.phoneNumber}@s.whatsapp.net` : null;

    if (!remoteJid) {
      const detail = isGroup
        ? `group conversation ${conversationId} has no groupJid`
        : `individual conversation ${conversationId} has no client/participant`;
      throw new BadRequestException(`Cannot resolve recipient: ${detail}`);
    }

    return remoteJid;
  }
}
