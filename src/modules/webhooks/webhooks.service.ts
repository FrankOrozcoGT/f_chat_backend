import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhoneStatus, MessageType, MessageDirection, MessageSenderType, MessageStatus } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EvolutionService } from '@common/evolution/evolution.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly configService: ConfigService,
  ) {}
  /**
   * Parsea el estado de conexión desde el webhook data
   * @param webhookData - Datos del webhook
   * @returns Estado del teléfono
   */
  parseConnectionStatus(webhookData: any): { status: PhoneStatus } {
    const state = webhookData?.data?.state;

    let status: PhoneStatus;
    switch (state) {
      case 'open':
        status = PhoneStatus.connected;
        break;
      case 'close':
      case 'connecting':
        status = PhoneStatus.disconnected;
        break;
      default:
        status = PhoneStatus.disconnected;
    }

    return { status };
  }

  /**
   * Extrae el código QR base64 del webhook data
   * @param webhookData - Datos del webhook
   * @returns Código QR en base64
   */
  parseQrCode(webhookData: any): string {
    return webhookData?.data?.qrcode || webhookData?.data?.qr || '';
  }

  /**
   * Extrae y limpia los datos del cliente desde el webhook
   * @param webhookData - Datos del webhook
   * @param fromMe - Indica si el mensaje fue enviado por mí
   * @returns Datos del cliente (phoneNumber, name)
   */
  buildClientData(webhookData: any, fromMe: boolean): { phoneNumber: string; name: string } {
    const remoteJid = webhookData?.data?.key?.remoteJid || '';

    // Si fromMe=true, pushName es MI nombre (del número registrado), no del destinatario
    // Solo usar pushName cuando fromMe=false (mensaje entrante del cliente)
    const pushName = !fromMe ? (webhookData?.data?.pushName || 'Unknown') : 'Unknown';

    // Limpiar formato: 5521999999999@s.whatsapp.net -> 5521999999999
    const phoneNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');

    return {
      phoneNumber,
      name: pushName,
    };
  }

  /**
   * Construye los datos de una conversación
   * @param phoneId - ID del teléfono
   * @param clientId - ID del cliente
   * @returns Datos de la conversación
   */
  buildConversationData(phoneId: string, clientId: string) {
    return {
      phoneId,
      clientId,
      isActive: true,
    };
  }

  /**
   * Detecta si el webhook contiene media
   * @param webhookData - Datos del webhook
   * @returns true si hay media
   */
  hasMedia(webhookData: any): boolean {
    const messageData = webhookData?.data?.message || {};
    return !!(
      messageData.imageMessage ||
      messageData.videoMessage ||
      messageData.audioMessage ||
      messageData.documentMessage
    );
  }

  /**
   * Construye los datos de un mensaje entrante
   * @param webhookData - Datos del webhook
   * @param conversationId - ID de la conversación
   * @param mediaData - Datos del archivo descargado (opcional)
   * @returns Datos del mensaje entrante
   */
  buildIncomingMessageData(
    webhookData: any,
    conversationId: string,
    mediaData?: { localPath: string; fileName: string; fileSize: number; mimeType: string } | null,
  ) {
    const messageData = webhookData?.data?.message || {};

    // Detectar tipo de mensaje
    let type: MessageType = MessageType.text;
    let content = '';

    if (messageData.conversation) {
      type = MessageType.text;
      content = messageData.conversation;
    } else if (messageData.extendedTextMessage) {
      type = MessageType.text;
      content = messageData.extendedTextMessage.text;
    } else if (messageData.imageMessage) {
      type = MessageType.image;
      content = messageData.imageMessage.caption || '';
    } else if (messageData.videoMessage) {
      type = MessageType.image; // Video se mapea a image por ahora
      content = messageData.videoMessage.caption || '';
    } else if (messageData.audioMessage) {
      type = MessageType.voice;
      content = '';
    } else if (messageData.documentMessage) {
      type = MessageType.text; // Document se mapea a text por ahora
      content = messageData.documentMessage.fileName || '';
    }

    return {
      conversationId,
      type,
      content,
      mediaUrl: mediaData?.localPath || null,
      fileName: mediaData?.fileName || null,
      fileSize: mediaData?.fileSize || null,
      mimeType: mediaData?.mimeType || null,
      direction: MessageDirection.incoming,
      senderType: MessageSenderType.client,
      status: MessageStatus.delivered,
    };
  }

  /**
   * Construye los datos de un mensaje saliente desde WhatsApp Web
   * @param webhookData - Datos del webhook
   * @param conversationId - ID de la conversación
   * @param mediaData - Datos del archivo descargado (opcional)
   * @returns Datos del mensaje saliente
   */
  buildOutgoingMessageFromWebhook(
    webhookData: any,
    conversationId: string,
    mediaData?: { localPath: string; fileName: string; fileSize: number; mimeType: string } | null,
  ) {
    const messageData = webhookData?.data?.message || {};

    // Detectar tipo de mensaje
    let type: MessageType = MessageType.text;
    let content = '';

    if (messageData.conversation) {
      type = MessageType.text;
      content = messageData.conversation;
    } else if (messageData.extendedTextMessage) {
      type = MessageType.text;
      content = messageData.extendedTextMessage.text;
    } else if (messageData.imageMessage) {
      type = MessageType.image;
      content = messageData.imageMessage.caption || '';
    } else if (messageData.videoMessage) {
      type = MessageType.image; // Video se mapea a image por ahora
      content = messageData.videoMessage.caption || '';
    } else if (messageData.audioMessage) {
      type = MessageType.voice;
      content = '';
    } else if (messageData.documentMessage) {
      type = MessageType.text; // Document se mapea a text por ahora
      content = messageData.documentMessage.fileName || '';
    }

    return {
      conversationId,
      type,
      content,
      mediaUrl: mediaData?.localPath || null,
      fileName: mediaData?.fileName || null,
      fileSize: mediaData?.fileSize || null,
      mimeType: mediaData?.mimeType || null,
      direction: MessageDirection.outgoing,
      senderType: MessageSenderType.agent,
      status: MessageStatus.sent,
    };
  }

  /**
   * Construye la actualización de conversación con último mensaje
   * @param message - Mensaje a usar para actualizar
   * @returns Datos de actualización
   */
  buildConversationUpdate(message: { content: string; createdAt?: Date }) {
    return {
      lastMessageAt: message.createdAt || new Date(),
      lastMessagePreview: message.content.substring(0, 100),
    };
  }

  /**
   * Descarga y guarda un archivo multimedia localmente usando Evolution API
   * @param instanceName - Nombre de la instancia
   * @param userId - ID del usuario
   * @param conversationId - ID de la conversación
   * @param messageId - ID del mensaje
   * @param webhookData - Datos del webhook para extraer message key y metadata
   * @returns Ruta local del archivo y metadata
   */
  async downloadAndSaveMedia(
    instanceName: string,
    userId: string,
    conversationId: string,
    messageId: string,
    webhookData: any,
  ): Promise<{
    localPath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }> {
    try {
      // 1. Extraer message key del webhook
      const messageKey = webhookData?.data?.key;
      if (!messageKey) {
        throw new Error('Message key not found in webhook data');
      }

      // 2. Obtener media en base64 desde Evolution API
      const mediaData = await this.evolutionService.getBase64FromMediaMessage(
        instanceName,
        messageKey,
      );

      // 3. Convertir base64 a buffer
      const buffer = Buffer.from(mediaData.base64, 'base64');

      // 4. Extraer extensión del archivo
      const fileExtension = this.getFileExtension(
        mediaData.fileName,
        mediaData.mimetype,
      );

      // 5. Construir ruta de almacenamiento
      const storageDir = path.join(
        process.cwd(),
        'storage',
        'conversations',
        userId,
        conversationId,
      );

      // 6. Crear directorio si no existe
      await fs.mkdir(storageDir, { recursive: true });

      // 7. Nombre del archivo: messageId_timestamp.ext
      const fileName = `${messageId}_${Date.now()}${fileExtension}`;
      const filePath = path.join(storageDir, fileName);

      // 8. Guardar archivo
      await fs.writeFile(filePath, buffer);

      // 9. Path relativo (sin dominio, se agregará al leer)
      const relativePath = `/storage/conversations/${userId}/${conversationId}/${fileName}`;

      this.logger.log(
        `Media file saved: ${relativePath} (${buffer.length} bytes)`,
      );

      return {
        localPath: relativePath, // Path relativo, sin dominio
        fileName: mediaData.fileName,
        fileSize: mediaData.size,
        mimeType: mediaData.mimetype,
      };
    } catch (error) {
      this.logger.error(
        `Failed to download and save media for message: ${messageId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Extrae la extensión del archivo desde nombre o mimeType
   */
  private getFileExtension(fileName: string, mimeType: string): string {
    // Intentar desde fileName
    const match = fileName.match(/\.[^.]+$/);
    if (match) return match[0];

    // Fallback: desde mimeType
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'application/pdf': '.pdf',
    };

    return mimeToExt[mimeType] || '.bin';
  }
}
