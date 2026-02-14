import { Injectable, Logger, BadRequestException, BadGatewayException } from '@nestjs/common';
import { EvolutionService, EvolutionMediaType } from '@common/evolution/evolution.service';
import { CacheService } from '@common/cache/cache.service';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { MessagesService } from './messages.service';
import { MessageType } from '@prisma/client';

export interface SendMessageParams {
  conversationId: string;
  userId: string;
  instanceId: string;
  clientPhone: string;
  tipo: MessageType;
  contenido: string;
  relativePath?: string | null;
  mediaUrlForEvolution?: string | null;
  messageId?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  senderType?: 'agent' | 'bot' | 'system';
}

@Injectable()
export class MessageSendService {
  private readonly logger = new Logger(MessageSendService.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly cacheService: CacheService,
    private readonly messageRepository: MessageRepository,
    private readonly messagesService: MessagesService,
  ) {}

  /**
   * Flujo centralizado de envío de mensajes.
   * Usado por: MessagesController (HITL) y AiAgentService (AI)
   *
   * 1. Envía vía Evolution API
   * 2. Cache para dedup
   * 3. Guarda en BD con transaction
   */
  async send(params: SendMessageParams) {
    const {
      conversationId,
      userId,
      instanceId,
      clientPhone,
      tipo,
      contenido,
      relativePath = null,
      mediaUrlForEvolution = null,
      messageId,
      mimeType,
      fileName,
      fileSize,
      senderType = 'agent',
    } = params;

    // 1. Enviar vía Evolution API
    let evolutionKeyId: string;
    try {
      let response: { key: { id: string } };
      if (tipo === MessageType.text) {
        response = await this.evolutionService.sendTextMessage(
          instanceId,
          clientPhone,
          contenido,
        );
      } else if (mediaUrlForEvolution) {
        const mediatype = this.mapMessageTypeToMediaType(tipo);

        response = await this.evolutionService.sendMediaMessage(
          instanceId,
          clientPhone,
          mediaUrlForEvolution,
          mediatype,
          contenido || undefined,
          mimeType,
          fileName,
        );
      } else {
        throw new BadRequestException(
          'mediaUrl is required for multimedia messages',
        );
      }

      evolutionKeyId = response.key.id;
      this.logger.log(`Evolution API accepted message for ${clientPhone}, keyId: ${evolutionKeyId}`);
    } catch (error) {
      this.logger.error(`Evolution API rejected message: ${error.message}`);
      throw new BadGatewayException('Failed to send message via WhatsApp');
    }

    // 2. Cache para dedup (webhook no duplica este mensaje)
    this.cacheService.set(
      `sent_message:${evolutionKeyId}`,
      { userId, conversationId },
      300,
    );

    this.logger.log(`Cache SET: sent_message:${evolutionKeyId}`);

    // 3. Construir messageData
    const messageData = this.messagesService.buildOutgoingMessageData(
      conversationId,
      tipo,
      contenido,
      'pending',
      relativePath,
      evolutionKeyId,
      fileName || null,
      fileSize || null,
      mimeType || null,
      senderType,
    );

    // 4. Guardar en BD con transaction
    const conversationUpdate = {
      lastMessageAt: new Date(),
      lastMessagePreview: contenido.substring(0, 100),
    };

    try {
      const { message } = await this.messageRepository.sendMessageTransaction(
        conversationId,
        userId,
        messageData,
        conversationUpdate,
        messageId,
      );

      this.logger.log(`Message saved with status 'pending', webhook will update status`);
      return message;
    } catch (error) {
      this.logger.error(`Failed to save message in DB: ${error.message}`);
      throw new BadGatewayException('Message sent but failed to save in database');
    }
  }

  private mapMessageTypeToMediaType(tipo: MessageType): EvolutionMediaType {
    switch (tipo) {
      case MessageType.image:
        return EvolutionMediaType.IMAGE;
      case MessageType.video:
        return EvolutionMediaType.VIDEO;
      case MessageType.voice:
      case MessageType.audio:
        return EvolutionMediaType.AUDIO;
      case MessageType.document:
        return EvolutionMediaType.DOCUMENT;
      default:
        throw new BadRequestException(`Unsupported media type: ${tipo}`);
    }
  }
}
