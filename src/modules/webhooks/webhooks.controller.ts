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
import { CacheService } from '@common/cache/cache.service';
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
    private readonly cacheService: CacheService,
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
        await this.handleMessagesUpsert(phone.id, instanceId, webhookData);
        break;

      case 'messages.update':
        await this.handleMessagesUpdate(phone.id, instanceId, webhookData);
        break;

      default:
        // Ignorar eventos no manejados
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

    // NUEVO: Verificar cache si es mensaje saliente (fromMe=true)
    if (fromMe && messageKey) {
      const wasSentByAPI = this.cacheService.has(`sent_message:${messageKey.id}`);

      if (wasSentByAPI) {
        this.logger.log(`Message ${messageKey.id} sent via API, skipping webhook creation`);
        return; // Skip - mensaje ya fue creado por POST /send
      }

      // Si NO está en cache, es mensaje desde WhatsApp Web
      this.logger.log(`Message ${messageKey.id} sent from WhatsApp Web, saving`);
    }

    // 1. Construir datos del Client (pasar fromMe para no usar pushName incorrecto)
    const clientData = this.webhooksService.buildClientData(webhookData, fromMe);

    // Ignorar mensajes de grupos (terminan en @g.us)
    if (clientData.phoneNumber.endsWith('@g.us')) {
      // Silently ignore group messages
      return;
    }

    // 2. Upsert Client
    const client = await this.clientRepository.upsert(clientData);

    // 3. Construir y upsert Conversation
    const conversationData = this.webhooksService.buildConversationData(phoneId, client.id);
    const conversation = await this.conversationRepository.upsert(conversationData);

    // 4. Si hay media, descargar ANTES de crear el mensaje (usando FileStorageService)
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
            messageKey.id, // Usar ID de WhatsApp para nombrar archivo
            messageKey,
          );
          this.logger.log(`Media downloaded: ${mediaData.relativePath}`);
        }
      } catch (error) {
        this.logger.error(`Failed to download media`, error.message);
        // Continuar sin media si falla
      }
    }

    // 5. Construir mensaje según dirección (con mediaData si existe)
    const messageData = fromMe
      ? this.webhooksService.buildOutgoingMessageFromWebhook(webhookData, conversation.id, mediaData)
      : this.webhooksService.buildIncomingMessageData(webhookData, conversation.id, mediaData);

    // 6. Crear mensaje (ya con mediaUrl correcto)
    const message = await this.messageRepository.create(messageData);

    // 7. Actualizar último mensaje de la conversación
    const conversationUpdate = this.webhooksService.buildConversationUpdate(message);
    await this.conversationRepository.updateLastMessage(conversation.id, conversationUpdate);

    // 8. Emitir eventos WebSocket
    if (fromMe) {
      this.websocketGateway.emit('message:sent', { ...message, fromExternal: true });
      console.log(`[Webhook] Outgoing message from WhatsApp Web for conversation ${conversation.id}`);
    } else {
      this.websocketGateway.emit('message:incoming', message);
      console.log(`[Webhook] Incoming message for conversation ${conversation.id}`);
    }

    // 9. Si mode=AI y es mensaje entrante de audio, emitir evento para AI agent
    if (!fromMe && conversation.mode === 'AI') {
      const isAudioMessage = message.type === 'voice' || message.type === 'audio';

      if (isAudioMessage && mediaData) {
        const phone = await this.phoneRepository.findById(phoneId);
        if (phone) {
          this.eventEmitter.emit('ai.incoming.audio', {
            messageId: message.id,
            conversationId: conversation.id,
            instanceName,
            clientPhone: clientData.phoneNumber,
            userId: phone.userId,
            mediaRelativePath: mediaData.relativePath,
          });
          this.logger.log(`Emitted ai.incoming.audio for conversation ${conversation.id}`);
        }
      }
    }
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
