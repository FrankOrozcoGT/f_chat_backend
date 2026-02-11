import { Injectable, Logger } from '@nestjs/common';
import { PhoneStatus, MessageType, MessageDirection, MessageSenderType, MessageStatus } from '@prisma/client';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor() {}
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
    mediaData?: { relativePath: string; fileName: string; fileSize: number; mimeType: string } | null,
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
      type = MessageType.video;
      content = messageData.videoMessage.caption || '';
    } else if (messageData.audioMessage) {
      type = MessageType.voice;
      content = '';
    } else if (messageData.documentMessage) {
      type = MessageType.document;
      content = messageData.documentMessage.caption || messageData.documentMessage.fileName || '';
    }

    return {
      conversationId,
      type,
      content,
      mediaUrl: mediaData?.relativePath || null,
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
    mediaData?: { relativePath: string; fileName: string; fileSize: number; mimeType: string } | null,
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
      type = MessageType.video;
      content = messageData.videoMessage.caption || '';
    } else if (messageData.audioMessage) {
      type = MessageType.voice;
      content = '';
    } else if (messageData.documentMessage) {
      type = MessageType.document;
      content = messageData.documentMessage.caption || messageData.documentMessage.fileName || '';
    }

    return {
      conversationId,
      type,
      content,
      mediaUrl: mediaData?.relativePath || null,
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

}
