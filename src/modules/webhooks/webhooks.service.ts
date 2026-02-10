import { Injectable } from '@nestjs/common';
import { PhoneStatus, MessageType, MessageDirection, MessageSenderType, MessageStatus } from '@prisma/client';

@Injectable()
export class WebhooksService {
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
   * Construye los datos de un mensaje entrante
   * @param webhookData - Datos del webhook
   * @param conversationId - ID de la conversación
   * @returns Datos del mensaje entrante
   */
  buildIncomingMessageData(webhookData: any, conversationId: string) {
    const messageData = webhookData?.data?.message || {};

    // Detectar tipo de mensaje
    let type: MessageType = MessageType.text;
    let content = '';
    let mediaUrl: string | null = null;

    if (messageData.conversation) {
      type = MessageType.text;
      content = messageData.conversation;
    } else if (messageData.extendedTextMessage) {
      type = MessageType.text;
      content = messageData.extendedTextMessage.text;
    } else if (messageData.imageMessage) {
      type = MessageType.image;
      content = messageData.imageMessage.caption || '';
      mediaUrl = messageData.imageMessage.url || null;
    } else if (messageData.videoMessage) {
      type = MessageType.image; // Video se mapea a image por ahora
      content = messageData.videoMessage.caption || '';
      mediaUrl = messageData.videoMessage.url || null;
    } else if (messageData.audioMessage) {
      type = MessageType.voice;
      content = '';
      mediaUrl = messageData.audioMessage.url || null;
    } else if (messageData.documentMessage) {
      type = MessageType.text; // Document se mapea a text por ahora
      content = messageData.documentMessage.fileName || '';
      mediaUrl = messageData.documentMessage.url || null;
    }

    return {
      conversationId,
      type,
      content,
      mediaUrl,
      direction: MessageDirection.incoming,
      senderType: MessageSenderType.client,
      status: MessageStatus.delivered,
    };
  }

  /**
   * Construye los datos de un mensaje saliente desde WhatsApp Web
   * @param webhookData - Datos del webhook
   * @param conversationId - ID de la conversación
   * @returns Datos del mensaje saliente
   */
  buildOutgoingMessageFromWebhook(webhookData: any, conversationId: string) {
    const messageData = webhookData?.data?.message || {};

    // Detectar tipo de mensaje
    let type: MessageType = MessageType.text;
    let content = '';
    let mediaUrl: string | null = null;

    if (messageData.conversation) {
      type = MessageType.text;
      content = messageData.conversation;
    } else if (messageData.extendedTextMessage) {
      type = MessageType.text;
      content = messageData.extendedTextMessage.text;
    } else if (messageData.imageMessage) {
      type = MessageType.image;
      content = messageData.imageMessage.caption || '';
      mediaUrl = messageData.imageMessage.url || null;
    } else if (messageData.videoMessage) {
      type = MessageType.image; // Video se mapea a image por ahora
      content = messageData.videoMessage.caption || '';
      mediaUrl = messageData.videoMessage.url || null;
    } else if (messageData.audioMessage) {
      type = MessageType.voice;
      content = '';
      mediaUrl = messageData.audioMessage.url || null;
    } else if (messageData.documentMessage) {
      type = MessageType.text; // Document se mapea a text por ahora
      content = messageData.documentMessage.fileName || '';
      mediaUrl = messageData.documentMessage.url || null;
    }

    return {
      conversationId,
      type,
      content,
      mediaUrl,
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
