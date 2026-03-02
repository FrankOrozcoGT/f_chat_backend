import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from './repositories/client.repository';
import { MessageRepository } from './repositories/message.repository';
import { EvolutionService } from '@common/evolution/evolution.service';
import { PhoneQueueService } from './services/phone-queue.service';

@Controller('whatsapp/webhook')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly phoneRepository: PhoneRepository,
    private readonly clientRepository: ClientRepository,
    private readonly messageRepository: MessageRepository,
    private readonly evolutionService: EvolutionService,
    private readonly phoneQueueService: PhoneQueueService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() webhookData: any) {
    const event = webhookData.event;
    const instanceId = webhookData.instance;

    // Buscar phone por evolutionInstanceId
    const phone =
      await this.phoneRepository.findByEvolutionInstanceId(instanceId);

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
        userId: phone.userId,
        instanceName: phone.instanceName,
        webhookData,
      };

      switch (event) {
        case 'messages.upsert':
        case 'send.message':
          await this.phoneQueueService.enqueue({
            ...jobData,
            type: 'process-message',
          });
          break;

        case 'contacts.upsert':
          await this.phoneQueueService.enqueue({
            ...jobData,
            type: 'sync-contacts',
          });
          break;

        case 'groups.upsert':
          await this.phoneQueueService.enqueue({
            ...jobData,
            type: 'sync-group',
          });
          break;

        case 'chats.set':
          await this.phoneQueueService.enqueue({
            ...jobData,
            type: 'sync-chats',
          });
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
        await this.handleQrCodeUpdated(phone.id, webhookData);
        break;

      case 'connection.update':
        await this.handleConnectionUpdate(phone.id, webhookData);
        break;

      case 'messages.update':
        await this.handleMessagesUpdate(phone.id, instanceId, webhookData);
        break;

      case 'messages.set':
        await this.handleMessagesSet(phone.id, webhookData);
        break;

      case 'contacts.update':
        await this.handleContactsUpdate(webhookData);
        break;

      default:
        this.logger.log(
          `[${new Date().toISOString()}] [Webhook] Unhandled event: ${event} - data: ${JSON.stringify(webhookData?.data).substring(0, 200)}`,
        );
        break;
    }

    return { message: 'Webhook processed' };
  }

  /**
   * Maneja evento QRCODE_UPDATED
   */
  private async handleQrCodeUpdated(phoneId: string, webhookData: any) {
    const qrCode = this.webhooksService.parseQrCode(webhookData);

    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(
        `Phone ${phoneId} not found, cannot emit WebSocket event`,
      );
      return;
    }

    this.logger.log(
      `[${new Date().toISOString()}] phone:qr_updated phone=${phoneId} userId=${phone.userId}`,
    );

    this.websocketGateway.emit(
      'phone:qr_updated',
      { phoneId, qrCode },
      phone.userId,
    );
  }

  /**
   * Maneja evento CONNECTION_UPDATE
   */
  private async handleConnectionUpdate(phoneId: string, webhookData: any) {
    const { status } = this.webhooksService.parseConnectionStatus(webhookData);

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
      `[${new Date().toISOString()}] phone:status_changed phone=${phoneId} userId=${phone.userId} status=${status}`,
    );

    this.websocketGateway.emit(
      'phone:status_changed',
      { phoneId, status },
      phone.userId,
    );

    // Si conectó, avisar al frontend que empieza el sync
    if (status === 'connected') {
      this.websocketGateway.emit(
        'phone:syncing',
        { phoneId, contactsCount: 0 },
        phone.userId,
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
  private async handleMessagesSet(phoneId: string, webhookData: any) {
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
      phone.userId,
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
    instanceName: string,
    webhookData: any,
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

    this.logger.log(`Mapped status '${status}' to '${mappedStatus}'`);

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
        phone.userId,
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
  private async handleContactsUpdate(webhookData: any) {
    const contacts = Array.isArray(webhookData?.data)
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
          `[contacts.update] Updated profilePicUrl for ${phoneNumber}`,
        );
      }
    }
  }
}
