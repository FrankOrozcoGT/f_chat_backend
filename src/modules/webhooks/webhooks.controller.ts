import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Headers,
  HttpCode,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { PhoneRepository } from '../phones/repositories/phone.repository';
import { ClientRepository } from './repositories/client.repository';
import { ConversationRepository } from './repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';

@Controller('whatsapp/webhook')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly phoneRepository: PhoneRepository,
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-api-key') apiKey: string,
    @Body() webhookData: any,
  ) {
    // Validar x-api-key
    const evolutionApiKey = this.configService.get<string>('EVOLUTION_API_KEY');
    if (apiKey !== evolutionApiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    const event = webhookData.event;
    const instanceId = webhookData.instance;

    // Buscar phone por evolutionInstanceId
    const phone = await this.phoneRepository.findByEvolutionInstanceId(instanceId);
    if (!phone) {
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

    // Emitir evento WebSocket
    this.websocketGateway.emit('phone:qr_updated', { phoneId, qrCode });

    console.log(`[Webhook] QR Code updated for phone ${phoneId}`);
  }

  /**
   * Maneja evento CONNECTION_UPDATE
   */
  private async handleConnectionUpdate(phoneId: string, webhookData: any) {
    const { status } = this.webhooksService.parseConnectionStatus(webhookData);

    const lastConnected = status === 'connected' ? new Date() : undefined;
    await this.phoneRepository.updateStatus(phoneId, status, lastConnected);

    // Emitir evento WebSocket
    this.websocketGateway.emit('phone:status_changed', { phoneId, status });

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
