import { Injectable, Logger } from '@nestjs/common';
import { EvolutionService, EvolutionMediaType } from '@common/evolution/evolution.service';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { MessagesService } from '@modules/messages/messages.service';
import { AiRepository } from '../../repositories/ai.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { SessionRepository } from '../../repositories/session.repository';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { ApiHealthRepository } from '@modules/health/repositories/api-health.repository';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { MessageType } from '@prisma/client';
import { WorkflowStateType } from '../state.interface';

@Injectable()
export class SendNode {
  private readonly logger = new Logger(SendNode.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly messageRepository: MessageRepository,
    private readonly messagesService: MessagesService,
    private readonly aiRepository: AiRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly apiHealthRepository: ApiHealthRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const {
      conversationId,
      userId,
      instanceName,
      clientPhone,
      preferredFormat,
      responseText,
      responseMediaRelativePath,
      responseMediaUrl,
      responseMimeType,
      responseFileName,
      responseFileSize,
      apiCalls,
      totalCost,
      intent,
      error,
    } = state;

    // Si hubo error en un node anterior → activar HITL (transparente para el cliente)
    if (error) {
      await this.apiHealthRepository.markAsDown(error.apiName, error.message);
      await this.conversationRepository.updateMode(conversationId, 'HITL');

      const activeSession = await this.sessionRepository.findActiveByConversationId(conversationId);
      if (activeSession) {
        await this.sessionRepository.close(activeSession.id, 'api_error');
      }

      await this.sessionRepository.createHitl(conversationId);

      this.websocketGateway.emitApiDown(error.apiName, error.message, userId);
      this.websocketGateway.emit('conversation:hitl', {
        conversationId,
        clientPhone,
        reason: 'api_error',
        apiName: error.apiName,
        timestamp: new Date().toISOString(),
      }, userId);

      this.logger.warn(`SendNode: API error (${error.apiName}) → HITL activated for ${conversationId}`);

      if (apiCalls.length > 0) {
        await this.aiRepository.saveApiCalls(apiCalls);
      }

      return {};
    }

    const tipo: MessageType = preferredFormat === 'audio' ? MessageType.voice : MessageType.text;

    // 1. Enviar vía Evolution API
    let evolutionKeyId: string;
    if (tipo === MessageType.text) {
      const response = await this.evolutionService.sendTextMessage(instanceName, clientPhone, responseText);
      evolutionKeyId = response.key.id;
    } else if (responseMediaUrl) {
      const mediatype = this.mapTypeToMediaType(tipo);
      const response = await this.evolutionService.sendMediaMessage(
        instanceName,
        clientPhone,
        responseMediaUrl,
        mediatype,
        responseText || undefined,
        responseMimeType || undefined,
        responseFileName || undefined,
      );
      evolutionKeyId = response.key.id;
    } else {
      throw new Error('mediaUrl is required for multimedia messages');
    }

    this.logger.log(`Evolution accepted message for ${clientPhone}, keyId: ${evolutionKeyId}`);

    // 2. Guardar en BD
    const messageData = this.messagesService.buildOutgoingMessageData(
      conversationId,
      tipo,
      responseText,
      'pending',
      responseMediaRelativePath,
      evolutionKeyId,
      responseFileName || null,
      responseFileSize || null,
      responseMimeType || null,
      'bot',
    );

    const { message } = await this.messageRepository.sendMessageTransaction(
      conversationId,
      userId,
      messageData,
      {
        lastMessageAt: new Date(),
        lastMessagePreview: responseText.substring(0, 100),
      },
    );

    // 3. Guardar API calls y costo
    if (apiCalls.length > 0) {
      await this.aiRepository.saveApiCalls(apiCalls);
    }
    await this.aiRepository.saveMessage(message.id, totalCost);

    this.logger.log(`SendNode: message sent for ${conversationId} | type=${tipo} | cost=$${totalCost.toFixed(6)}`);

    // 4. Verificar créditos
    const user = await this.userRepository.findById(userId);
    if (user && user.creditsUsed > user.creditsLimit) {
      this.logger.warn(`Credits exceeded after processing for user ${userId}, conversation ${conversationId}`);

      this.websocketGateway.emitCreditsExhausted(userId, conversationId, user.creditsUsed, user.creditsLimit);
      await this.conversationRepository.updateMode(conversationId, 'HITL');

      const activeSession = await this.sessionRepository.findActiveByConversationId(conversationId);
      if (activeSession) {
        await this.sessionRepository.close(activeSession.id, 'credits_exhausted');
      }

      await this.sessionRepository.createHitl(conversationId);
      this.logger.log(`SendNode: conversation ${conversationId} moved to HITL due to credits exhaustion`);
    }

    // 5. Switch a HITL si el intent lo requiere
    if (intent === 'switch_hitl') {
      await this.conversationRepository.updateMode(conversationId, 'HITL');

      const activeSession = await this.sessionRepository.findActiveByConversationId(conversationId);
      if (activeSession) {
        await this.sessionRepository.close(activeSession.id, 'client_request');
      }

      await this.sessionRepository.createHitl(conversationId);

      this.websocketGateway.emit('conversation:hitl', {
        conversationId,
        clientPhone,
        timestamp: new Date().toISOString(),
      }, userId);

      this.logger.log(`SendNode: conversation ${conversationId} switched to HITL mode`);
    }

    return {};
  }

  private mapTypeToMediaType(tipo: MessageType): EvolutionMediaType {
    switch (tipo) {
      case MessageType.image: return EvolutionMediaType.IMAGE;
      case MessageType.video: return EvolutionMediaType.VIDEO;
      case MessageType.voice:
      case MessageType.audio: return EvolutionMediaType.AUDIO;
      case MessageType.document: return EvolutionMediaType.DOCUMENT;
      default: throw new Error(`Unsupported media type: ${tipo}`);
    }
  }
}
