import { Injectable, Logger } from '@nestjs/common';
import {
  PhoneStatus,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
} from '@prisma/client';
import { EvolutionService } from '@common/evolution/evolution.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly evolutionService: EvolutionService) {}
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
  buildClientData(
    webhookData: any,
    fromMe: boolean,
  ): { phoneNumber: string; name: string; profilePicUrl?: string | null } {
    const remoteJid = webhookData?.data?.key?.remoteJid || '';

    // Si fromMe=true, pushName es MI nombre (del número registrado), no del destinatario
    // Solo usar pushName cuando fromMe=false (mensaje entrante del cliente)
    const pushName = !fromMe
      ? webhookData?.data?.pushName || 'Unknown'
      : 'Unknown';

    // Limpiar formato: 5521999999999@s.whatsapp.net -> 5521999999999
    const phoneNumber = remoteJid
      .replace('@s.whatsapp.net', '')
      .replace('@c.us', '');

    const profilePicUrl = webhookData?.data?.profilePicUrl || null;

    this.logger.log(
      `[buildClientData] phoneNumber=${phoneNumber} pushName=${pushName} profilePicUrl=${profilePicUrl}`,
    );

    return {
      phoneNumber,
      name: pushName,
      profilePicUrl,
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
    mediaData?: {
      relativePath: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    } | null,
  ) {
    const messageData = webhookData?.data?.message || {};
    const { type, content } =
      this.evolutionService.parseMessageContent(messageData);

    const keyId = webhookData?.data?.key?.id;
    const quotedStanzaId = this.extractQuotedStanzaId(messageData);
    const metadata: Record<string, any> = {};
    if (keyId) metadata.keyId = keyId;
    if (quotedStanzaId) metadata.quotedMessageId = quotedStanzaId;

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
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
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
    mediaData?: {
      relativePath: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    } | null,
  ) {
    const messageData = webhookData?.data?.message || {};
    const { type, content } =
      this.evolutionService.parseMessageContent(messageData);

    const keyId = webhookData?.data?.key?.id;
    const quotedStanzaId = this.extractQuotedStanzaId(messageData);
    const metadata: Record<string, any> = {};
    if (keyId) metadata.keyId = keyId;
    if (quotedStanzaId) metadata.quotedMessageId = quotedStanzaId;

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
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    };
  }

  /**
   * Extrae el stanzaId del mensaje citado (reply) desde contextInfo
   */
  extractQuotedStanzaId(messageData: Record<string, any>): string | null {
    const msgTypes = [
      'extendedTextMessage',
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'documentMessage',
    ];
    for (const msgType of msgTypes) {
      const stanzaId = messageData[msgType]?.contextInfo?.stanzaId;
      if (stanzaId) return stanzaId;
    }
    return null;
  }

  /**
   * Construye los datos de un mensaje de grupo entrante
   * Extrae senderJid y senderName del webhook para guardar en metadata
   */
  buildGroupMessageData(
    webhookData: any,
    conversationId: string,
    mediaData?: {
      relativePath: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    } | null,
  ) {
    const messageData = webhookData?.data?.message || {};
    const { type, content } =
      this.evolutionService.parseMessageContent(messageData);

    const keyId = webhookData?.data?.key?.id;
    const senderJid = webhookData?.data?.key?.participant || null;
    const senderName = webhookData?.data?.pushName || null;
    const quotedStanzaId = this.extractQuotedStanzaId(messageData);

    const metadata: Record<string, any> = {};
    if (keyId) metadata.keyId = keyId;
    if (senderJid) metadata.senderJid = senderJid;
    if (senderName) metadata.senderName = senderName;
    if (quotedStanzaId) metadata.quotedMessageId = quotedStanzaId;

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
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
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
