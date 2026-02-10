import {
  Controller,
  Post,
  Body,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { PhoneRepository } from '../phones/repositories/phone.repository';
import { ClientRepository } from './repositories/client.repository';
import { ConversationRepository } from './repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';

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
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Body() webhookData: any,
  ) {
    // Log webhook received
    this.logger.log(`Webhook received: ${webhookData.event} for instance ${webhookData.instance}`);

    const event = webhookData.event;
    const instanceId = webhookData.instance;

    // Buscar phone por evolutionInstanceId
    const phone = await this.phoneRepository.findByEvolutionInstanceId(instanceId);
    if (!phone) {
      this.logger.warn(`Phone not found for instance ${instanceId}, ignoring webhook`);
      return { message: 'Phone not found, ignoring webhook' };
    }

    this.logger.log(`Found phone ${phone.id} for instance ${instanceId}`);

    // Procesar según evento
    switch (event) {
      case 'qrcode.updated':
        await this.handleQrCodeUpdated(phone.id, webhookData);
        break;

      case 'connection.update':
        await this.handleConnectionUpdate(phone.id, webhookData);
        break;

      case 'messages.upsert':
        await this.handleMessagesUpsert(phone.id, webhookData);
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
  private async handleMessagesUpsert(phoneId: string, webhookData: any) {
    const fromMe = webhookData?.data?.key?.fromMe || false;

    // 1. Construir y upsert Client
    const clientData = this.webhooksService.buildClientData(webhookData);
    const client = await this.clientRepository.upsert(clientData);

    // 2. Construir y upsert Conversation
    const conversationData = this.webhooksService.buildConversationData(phoneId, client.id);
    const conversation = await this.conversationRepository.upsert(conversationData);

    // 3. Construir mensaje según dirección
    let messageData;
    if (fromMe) {
      // Mensaje saliente desde WhatsApp Web
      messageData = this.webhooksService.buildOutgoingMessageFromWebhook(
        webhookData,
        conversation.id,
      );
    } else {
      // Mensaje entrante del cliente
      messageData = this.webhooksService.buildIncomingMessageData(
        webhookData,
        conversation.id,
      );
    }

    // 4. Crear mensaje
    const message = await this.messageRepository.create(messageData);

    // 5. Actualizar último mensaje de la conversación
    const conversationUpdate = this.webhooksService.buildConversationUpdate(message);
    await this.conversationRepository.updateLastMessage(conversation.id, conversationUpdate);

    // 6. Emitir eventos WebSocket
    if (fromMe) {
      this.websocketGateway.emit('message:sent', { ...message, fromExternal: true });
      console.log(`[Webhook] Outgoing message from WhatsApp Web for conversation ${conversation.id}`);
    } else {
      this.websocketGateway.emit('message:incoming', message);
      console.log(`[Webhook] Incoming message for conversation ${conversation.id}`);
    }
  }
}
