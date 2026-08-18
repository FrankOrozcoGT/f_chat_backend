import { Injectable, Logger } from '@nestjs/common';
import {
  PhoneStatus,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
} from '@prisma/client';
import { EvolutionService, EvolutionMessage } from '@common/evolution/evolution.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from '@common/messaging/repositories/client.repository';
import { MessageRepository } from '@common/messaging/repositories/message.repository';
import { PhoneQueueService } from './services/phone-queue.service';
import type {
  EvolutionWebhookEvent,
  ConnectionUpdateData,
  QrCodeUpdateData,
  MessagesSetData,
  MessagesUpdateData,
  ContactUpdateEntry,
} from './types/evolution-webhook.types';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly phoneRepository: PhoneRepository,
    private readonly clientRepository: ClientRepository,
    private readonly messageRepository: MessageRepository,
    private readonly phoneQueueService: PhoneQueueService,
  ) {}

  /**
   * Entrypoint del webhook público de Evolution API. Encola eventos de
   * escritura pesada y procesa directo los eventos de lectura/update ligero.
   */
  async handleWebhook(webhookData: EvolutionWebhookEvent) {
    const event = webhookData.event;
    const instanceId = webhookData.instance;

    const phone = await this.phoneRepository.findByEvolutionInstanceId(instanceId);

    // ── Eventos que se encolan (escritura pesada) ──
    // Si el phone no existe, se encolan con retry para dar tiempo a que se cree
    if (
      event === 'messages.upsert' ||
      event === 'send.message' ||
      event === 'contacts.upsert' ||
      event === 'groups.upsert' ||
      event === 'chats.set'
    ) {
      if (!phone) {
        this.logger.warn(
          `Phone not found for instance ${instanceId}, enqueuing with retry for event=${event}`,
        );
        // No podemos encolar sin phoneId — ignorar
        return { message: 'Phone not found, ignoring webhook' };
      }

      const jobData = {
        phoneId: phone.id,
        tenantId: phone.tenantId,
        instanceName: phone.instanceName,
        webhookData,
      };

      switch (event) {
        case 'messages.upsert':
        case 'send.message':
          await this.phoneQueueService.enqueue({ ...jobData, type: 'process-message' });
          break;

        case 'contacts.upsert':
          await this.phoneQueueService.enqueue({ ...jobData, type: 'sync-contacts' });
          break;

        case 'groups.upsert':
          await this.phoneQueueService.enqueue({ ...jobData, type: 'sync-group' });
          break;

        case 'chats.set':
          await this.phoneQueueService.enqueue({ ...jobData, type: 'sync-chats' });
          break;
      }

      return { message: 'Webhook enqueued' };
    }

    // ── Eventos directos (lecturas / updates ligeros) ──
    if (!phone) {
      this.logger.warn(
        `Phone not found for instance ${instanceId}, ignoring webhook`,
      );
      return { message: 'Phone not found, ignoring webhook' };
    }

    switch (event) {
      case 'qrcode.updated':
        await this.handleQrCodeUpdated(
          phone.id,
          webhookData as EvolutionWebhookEvent<QrCodeUpdateData>,
        );
        break;

      case 'connection.update':
        await this.handleConnectionUpdate(
          phone.id,
          webhookData as EvolutionWebhookEvent<ConnectionUpdateData>,
        );
        break;

      case 'messages.update':
        await this.handleMessagesUpdate(
          phone.id,
          webhookData as EvolutionWebhookEvent<MessagesUpdateData>,
        );
        break;

      case 'messages.set':
        await this.handleMessagesSet(
          phone.id,
          webhookData as EvolutionWebhookEvent<MessagesSetData>,
        );
        break;

      case 'contacts.update':
        await this.handleContactsUpdate(
          webhookData as EvolutionWebhookEvent<ContactUpdateEntry | ContactUpdateEntry[]>,
        );
        break;

      default:
        break;
    }

    return { message: 'Webhook processed' };
  }

  /**
   * Maneja evento QRCODE_UPDATED
   */
  private async handleQrCodeUpdated(
    phoneId: string,
    webhookData: EvolutionWebhookEvent<QrCodeUpdateData>,
  ) {
    const qrCode = this.parseQrCode(webhookData);

    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(
        `Phone ${phoneId} not found, cannot emit WebSocket event`,
      );
      return;
    }

    this.logger.log(
      `[${new Date().toISOString()}] phone:qr_updated phone=${phoneId} tenantId=${phone.tenantId}`,
    );

    this.websocketGateway.emit(
      'phone:qr_updated',
      { phoneId, qrCode },
      phone.tenantId,
    );
  }

  /**
   * Maneja evento CONNECTION_UPDATE
   */
  private async handleConnectionUpdate(
    phoneId: string,
    webhookData: EvolutionWebhookEvent<ConnectionUpdateData>,
  ) {
    const { status } = this.parseConnectionStatus(webhookData);

    const lastConnected = status === 'connected' ? new Date() : undefined;
    await this.phoneRepository.updateStatus(phoneId, status, lastConnected);

    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(
        `[${new Date().toISOString()}] Phone ${phoneId} not found, cannot emit WebSocket event`,
      );
      return;
    }

    this.logger.log(
      `[${new Date().toISOString()}] phone:status_changed phone=${phoneId} tenantId=${phone.tenantId} status=${status}`,
    );

    this.websocketGateway.emit(
      'phone:status_changed',
      { phoneId, status },
      phone.tenantId,
    );

    // Si conectó, avisar al frontend que empieza el sync
    if (status === 'connected') {
      this.websocketGateway.emit(
        'phone:syncing',
        { phoneId, contactsCount: 0 },
        phone.tenantId,
      );
      this.logger.log(
        `[${new Date().toISOString()}] phone:syncing emitted for phone=${phoneId}`,
      );
    }
  }

  /**
   * Maneja evento MESSAGES_SET
   * Notifica al frontend el progreso de sincronización del historial
   */
  private async handleMessagesSet(
    phoneId: string,
    webhookData: EvolutionWebhookEvent<MessagesSetData>,
  ) {
    const isLatest: boolean = webhookData?.data?.isLatest ?? false;
    const progress: number = webhookData?.data?.progress ?? 0;
    this.logger.log(
      `[${new Date().toISOString()}] messages.set phone=${phoneId} progress=${progress} isLatest=${isLatest}`,
    );

    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) return;

    this.websocketGateway.emit(
      'phone:sync_progress',
      { phoneId, progress, isLatest },
      phone.tenantId,
    );

    this.logger.log(
      `Sync progress for phone ${phoneId}: ${progress}% - isLatest: ${isLatest}`,
    );
  }

  /**
   * Maneja evento MESSAGES_UPDATE
   * Actualiza el status de mensajes (sent, delivered, read, failed)
   */
  private async handleMessagesUpdate(
    phoneId: string,
    webhookData: EvolutionWebhookEvent<MessagesUpdateData>,
  ) {
    const data = webhookData?.data;

    if (!data) {
      this.logger.warn('messages.update: missing data');
      return;
    }

    const keyId = data.keyId;
    const status = data.status;
    const fromMe = data.fromMe;

    this.logger.log(
      `messages.update: keyId=${keyId}, status=${status}, fromMe=${fromMe}`,
    );

    // Solo procesar mensajes salientes (fromMe: true)
    if (!fromMe) {
      return;
    }

    // Mapear status de Evolution API (STRING) a nuestro enum
    let mappedStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

    switch (status) {
      case 'ERROR':
      case 'PENDING':
        mappedStatus = 'failed';
        break;
      case 'SERVER_ACK':
        mappedStatus = 'sent';
        break;
      case 'DELIVERY_ACK':
        mappedStatus = 'delivered';
        break;
      case 'READ':
      case 'PLAYED':
        mappedStatus = 'read';
        break;
      default:
        this.logger.warn(`Unknown status string: ${status}`);
        return;
    }

    try {
      const updatedMessage = await this.messageRepository.updateStatusByKeyId(
        keyId,
        mappedStatus,
      );

      if (!updatedMessage) {
        this.logger.warn(`Message with keyId ${keyId} not found in database`);
        return;
      }

      const phone = await this.phoneRepository.findById(phoneId);
      if (!phone) {
        this.logger.warn(`Phone ${phoneId} not found, cannot emit WebSocket`);
        return;
      }

      this.websocketGateway.emit(
        'message:status_updated',
        {
          messageId: updatedMessage.id,
          conversationId: updatedMessage.conversationId,
          status: mappedStatus,
        },
        phone.tenantId,
      );

      this.logger.log(
        `Message ${updatedMessage.id} updated to '${mappedStatus}' and WebSocket emitted`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update message with keyId ${keyId}: ${error.message}`, error.stack,
      );
      throw error;
    }
  }

  /**
   * Maneja evento CONTACTS_UPDATE
   * Actualiza profilePicUrl en nuestra DB solo si el cliente ya existe
   */
  private async handleContactsUpdate(
    webhookData: EvolutionWebhookEvent<ContactUpdateEntry | ContactUpdateEntry[]>,
  ) {
    const contacts: ContactUpdateEntry[] = Array.isArray(webhookData?.data)
      ? webhookData.data
      : [webhookData?.data];

    for (const contact of contacts) {
      const remoteJid = contact?.remoteJid;
      const profilePicUrl = contact?.profilePicUrl;

      if (
        !remoteJid ||
        !profilePicUrl ||
        !remoteJid.endsWith('@s.whatsapp.net')
      )
        continue;

      const phoneNumber = remoteJid.replace('@s.whatsapp.net', '');
      const updated = await this.clientRepository.updateProfilePicIfExists(
        phoneNumber,
        profilePicUrl,
      );

      if (updated.count > 0) {
        this.logger.log(
          `[contacts.update] Updated profilePicUrl for ${phoneNumber.substring(0, 6)}...`,
        );
      }
    }
  }

  /**
   * Parsea el estado de conexión desde el webhook data
   * @param webhookData - Datos del webhook
   * @returns Estado del teléfono
   */
  parseConnectionStatus(webhookData: EvolutionWebhookEvent<ConnectionUpdateData>): { status: PhoneStatus } {
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
  parseQrCode(webhookData: EvolutionWebhookEvent<QrCodeUpdateData>): string {
    return webhookData?.data?.qrcode || webhookData?.data?.qr || '';
  }

  /**
   * Extrae y limpia los datos del cliente desde el webhook
   * @param webhookData - Datos del webhook
   * @param fromMe - Indica si el mensaje fue enviado por mí
   * @returns Datos del cliente (phoneNumber, name)
   */
  buildClientData(
    webhookData: EvolutionWebhookEvent<EvolutionMessage & { profilePicUrl?: string | null }>,
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
  hasMedia(webhookData: EvolutionWebhookEvent<EvolutionMessage>): boolean {
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
    webhookData: EvolutionWebhookEvent<EvolutionMessage>,
    conversationId: string,
    mediaData?: {
      relativePath: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    } | null,
    groupMeta?: { senderJid?: string | null; senderName?: string | null; senderProfilePicUrl?: string | null } | null,
  ) {
    const messageData = webhookData?.data?.message || {};
    const { type, content } =
      this.evolutionService.parseMessageContent(messageData);

    const keyId = webhookData?.data?.key?.id;
    const topLevelContextInfo = webhookData?.data?.contextInfo || null;
    const quotedStanzaId = this.extractQuotedStanzaId(messageData, topLevelContextInfo);
    const metadata: Record<string, string> = {};
    if (keyId) metadata.keyId = keyId;
    if (quotedStanzaId) metadata.quotedMessageId = quotedStanzaId;
    if (groupMeta?.senderJid) metadata.senderJid = groupMeta.senderJid;
    if (groupMeta?.senderName) metadata.senderName = groupMeta.senderName;
    if (groupMeta?.senderProfilePicUrl) metadata.senderProfilePicUrl = groupMeta.senderProfilePicUrl;

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
    webhookData: EvolutionWebhookEvent<EvolutionMessage>,
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
    const topLevelContextInfo = webhookData?.data?.contextInfo || null;
    const quotedStanzaId = this.extractQuotedStanzaId(messageData, topLevelContextInfo);
    const metadata: Record<string, string> = {};
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
  extractQuotedStanzaId(
    messageData: NonNullable<EvolutionMessage['message']>,
    topLevelContextInfo?: { stanzaId?: string } | null,
  ): string | null {
    const msgTypes = [
      'extendedTextMessage',
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'documentMessage',
    ] as const;
    for (const msgType of msgTypes) {
      const stanzaId = (messageData[msgType] as { contextInfo?: { stanzaId?: string } } | undefined)
        ?.contextInfo?.stanzaId;
      if (stanzaId) return stanzaId;
    }
    if (topLevelContextInfo?.stanzaId) return topLevelContextInfo.stanzaId;
    return null;
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
