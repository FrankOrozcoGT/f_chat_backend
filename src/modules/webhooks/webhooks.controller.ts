import {
  Controller,
  Post,
  Body,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebhooksService } from './webhooks.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from './repositories/client.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { EvolutionService } from '@common/evolution/evolution.service';

@Controller('whatsapp/webhook')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly phoneRepository: PhoneRepository,
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly evolutionService: EvolutionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Body() webhookData: any,
  ) {
    const event = webhookData.event;
    const instanceId = webhookData.instance;

    // Buscar phone por evolutionInstanceId
    const phone = await this.phoneRepository.findByEvolutionInstanceId(instanceId);
    if (!phone) {
      this.logger.warn(`Phone not found for instance ${instanceId}, ignoring webhook`);
      return { message: 'Phone not found, ignoring webhook' };
    }

    // Procesar según evento
    switch (event) {
      case 'qrcode.updated':
        await this.handleQrCodeUpdated(phone.id, webhookData);
        break;

      case 'connection.update':
        await this.handleConnectionUpdate(phone.id, webhookData);
        break;

      case 'messages.upsert':
      case 'send.message':
        await this.handleMessagesUpsert(phone.id, instanceId, webhookData);
        break;

      case 'messages.update':
        await this.handleMessagesUpdate(phone.id, instanceId, webhookData);
        break;

      case 'messages.set':
        await this.handleMessagesSet(phone.id, webhookData);
        break;

      default:
        this.logger.log(`[Webhook] Unhandled event: ${event} - data: ${JSON.stringify(webhookData?.data).substring(0, 200)}`);
        break;
    }

    return { message: 'Webhook processed' };
  }

  /**
   * Maneja evento QRCODE_UPDATED
   */
  private async handleQrCodeUpdated(phoneId: string, webhookData: any) {
    const qrCode = this.webhooksService.parseQrCode(webhookData);

    // Obtener phone para saber el userId
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(`Phone ${phoneId} not found, cannot emit WebSocket event`);
      return;
    }

    this.logger.log(`Emitting phone:qr_updated for phone ${phoneId} to user ${phone.userId}`);

    // Emitir evento WebSocket solo al usuario dueño del phone
    this.websocketGateway.emit('phone:qr_updated', { phoneId, qrCode }, phone.userId);

    console.log(`[Webhook] QR Code updated for phone ${phoneId}`);
  }

  /**
   * Maneja evento CONNECTION_UPDATE
   */
  private async handleConnectionUpdate(phoneId: string, webhookData: any) {
    const { status } = this.webhooksService.parseConnectionStatus(webhookData);

    const lastConnected = status === 'connected' ? new Date() : undefined;
    await this.phoneRepository.updateStatus(phoneId, status, lastConnected);

    // Obtener phone para saber el userId
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(`Phone ${phoneId} not found, cannot emit WebSocket event`);
      return;
    }

    this.logger.log(`Emitting phone:status_changed for phone ${phoneId} to user ${phone.userId} with status ${status}`);

    // Emitir evento WebSocket solo al usuario dueño del phone
    this.websocketGateway.emit('phone:status_changed', { phoneId, status }, phone.userId);

    console.log(`[Webhook] Connection status updated for phone ${phoneId}: ${status}`);
  }

  /**
   * Maneja evento MESSAGES_UPSERT
   */
  private async handleMessagesUpsert(phoneId: string, instanceName: string, webhookData: any) {
    const fromMe = webhookData?.data?.key?.fromMe || false;
    const messageKey = webhookData?.data?.key;

    // 1. Si es mensaje saliente (fromMe), esperar 300ms para evitar race condition
    //    con MessageSendService que puede estar guardando en paralelo
    if (fromMe && messageKey) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const existingMessage = await this.messageRepository.findByMetadataKeyId(messageKey.id);

      if (existingMessage) {
        // Ya fue guardado por MessageSendService (HITL o AI) → solo emitir al frontend
        this.websocketGateway.emit('message:sent', existingMessage);
        this.logger.log(`Message ${messageKey.id} already in DB, emitted to frontend`);
        return;
      }

      // No existe en DB → enviado desde WhatsApp Web, seguir flujo normal
      this.logger.log(`Message ${messageKey.id} from WhatsApp Web, saving`);
    }

    // 2. Construir datos del Client (pasar fromMe para no usar pushName incorrecto)
    const clientData = this.webhooksService.buildClientData(webhookData, fromMe);

    // Ignorar mensajes de grupos (terminan en @g.us)
    if (clientData.phoneNumber.endsWith('@g.us')) {
      return;
    }

    // 3. Upsert Client
    const client = await this.clientRepository.upsert(clientData);

    // 4. Construir y upsert Conversation
    const conversationData = this.webhooksService.buildConversationData(phoneId, client.id);
    const conversation = await this.conversationRepository.upsert(conversationData);

    // 5. Si hay media, descargar ANTES de crear el mensaje
    let mediaData: { relativePath: string; fileName: string; fileSize: number; mimeType: string } | null = null;
    const hasMedia = this.webhooksService.hasMedia(webhookData);

    if (hasMedia && messageKey) {
      try {
        const phone = await this.phoneRepository.findById(phoneId);
        if (phone) {
          mediaData = await this.fileStorageService.downloadAndSaveMediaFromEvolution(
            this.evolutionService,
            instanceName,
            phone.userId,
            conversation.id,
            messageKey.id,
            messageKey,
          );
          this.logger.log(`Media downloaded: ${mediaData.relativePath}`);
        }
      } catch (error) {
        this.logger.error(`Failed to download media: ${error.message}`);
      }
    }

    // 6. Construir mensaje según dirección
    const messageData = fromMe
      ? this.webhooksService.buildOutgoingMessageFromWebhook(webhookData, conversation.id, mediaData)
      : this.webhooksService.buildIncomingMessageData(webhookData, conversation.id, mediaData);

    // 7. Guardar mensaje
    const message = await this.messageRepository.create(messageData);

    // 8. Actualizar último mensaje de la conversación
    const conversationUpdate = this.webhooksService.buildConversationUpdate(message);
    await this.conversationRepository.updateLastMessage(conversation.id, conversationUpdate);

    // 9. Emitir al frontend
    if (fromMe) {
      this.websocketGateway.emit('message:sent', { ...message, fromExternal: true });
      this.logger.log(`Outgoing message from WhatsApp Web for conversation ${conversation.id}`);
    } else {
      this.websocketGateway.emit('message:incoming', message);
      this.logger.log(`Incoming message for conversation ${conversation.id}`);
    }

    // 10. Si mode=AI y es mensaje entrante, emitir evento para AI agent
    if (!fromMe && conversation.mode === 'AI') {
      const phone = await this.phoneRepository.findById(phoneId);
      if (phone) {
        this.eventEmitter.emit('ai.incoming.message', {
          messageId: message.id,
          conversationId: conversation.id,
          instanceName,
          clientPhone: clientData.phoneNumber,
          userId: phone.userId,
          messageType: message.type,
          content: message.content,
          mediaRelativePath: mediaData?.relativePath || null,
          mediaMetadata: mediaData ? { fileName: mediaData.fileName, mimeType: mediaData.mimeType } : null,
        });
        this.logger.log(`Emitted ai.incoming.message for conversation ${conversation.id}`);
      }
    }
  }

  /**
   * Maneja evento MESSAGES_SET
   * Notifica al frontend el progreso de sincronización del historial
   */
  private async handleMessagesSet(phoneId: string, webhookData: any) {
    this.logger.log(`[messages.set] raw data: ${JSON.stringify(webhookData?.data).substring(0, 300)}`);
    const isLatest: boolean = webhookData?.data?.isLatest ?? false;
    const progress: number = webhookData?.data?.progress ?? 0;

    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) return;

    this.websocketGateway.emit(
      'phone:sync_progress',
      { phoneId, progress, isLatest },
      phone.userId,
    );

    this.logger.log(`Sync progress for phone ${phoneId}: ${progress}% - isLatest: ${isLatest}`);
  }

  /**
   * Maneja evento MESSAGES_UPDATE
   * Actualiza el status de mensajes (sent, delivered, read, failed)
   */
  private async handleMessagesUpdate(phoneId: string, instanceName: string, webhookData: any) {
    const data = webhookData?.data;

    if (!data) {
      this.logger.warn('messages.update: missing data');
      return;
    }

    const keyId = data.keyId; // ID del mensaje de WhatsApp (Evolution API)
    const status = data.status; // STRING: "SERVER_ACK", "DELIVERY_ACK", "READ", etc.
    const fromMe = data.fromMe;

    this.logger.log(`messages.update: keyId=${keyId}, status=${status}, fromMe=${fromMe}`);

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

    this.logger.log(`Mapped status '${status}' to '${mappedStatus}'`);

    // Buscar mensaje por keyId en metadata
    try {
      const updatedMessage = await this.messageRepository.updateStatusByKeyId(keyId, mappedStatus);

      if (!updatedMessage) {
        this.logger.warn(`Message with keyId ${keyId} not found in database`);
        return;
      }

      // Obtener phone para saber el userId
      const phone = await this.phoneRepository.findById(phoneId);
      if (!phone) {
        this.logger.warn(`Phone ${phoneId} not found, cannot emit WebSocket`);
        return;
      }

      // Emitir evento WebSocket al usuario dueño del phone
      this.websocketGateway.emit(
        'message:status_updated',
        {
          messageId: updatedMessage.id,
          conversationId: updatedMessage.conversationId,
          status: mappedStatus,
        },
        phone.userId,
      );

      this.logger.log(`Message ${updatedMessage.id} updated to '${mappedStatus}' and WebSocket emitted`);
    } catch (error) {
      this.logger.error(`Failed to update message with keyId ${keyId}: ${error.message}`);
    }
  }
}
