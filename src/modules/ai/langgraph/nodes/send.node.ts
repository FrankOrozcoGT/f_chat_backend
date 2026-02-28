import { Injectable, Logger } from '@nestjs/common';
import {
  EvolutionService,
  EvolutionMediaType,
} from '@common/evolution/evolution.service';
import { AiRepository } from '../../repositories/ai.repository';
import { SessionRepository } from '../../repositories/session.repository';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { InternalApiClient } from '../../clients/internal-api.client';
import { MessageType } from '@prisma/client';
import { WorkflowStateType } from '../state.interface';
import { buildOutgoingMessageData } from '@common/utils/build-outgoing-message-data';

@Injectable()
export class SendNode {
  private readonly logger = new Logger(SendNode.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly aiRepository: AiRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly internalApi: InternalApiClient,
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
      await this.internalApi.markApiDown(error.apiName, error.message);
      await this.internalApi.updateConversationMode(conversationId, 'HITL');

      const activeSession =
        await this.sessionRepository.findActiveByConversationId(conversationId);
      if (activeSession) {
        await this.sessionRepository.close(activeSession.id, 'api_error');
      }

      await this.sessionRepository.createHitl(conversationId);

      this.websocketGateway.emitApiDown(error.apiName, error.message, userId);
      this.websocketGateway.emit(
        'conversation:hitl',
        {
          conversationId,
          clientPhone,
          reason: 'api_error',
          apiName: error.apiName,
          timestamp: new Date().toISOString(),
        },
        userId,
      );

      this.logger.warn(
        `SendNode: API error (${error.apiName}) → HITL activated for ${conversationId}`,
      );

      if (apiCalls.length > 0) {
        await this.aiRepository.saveApiCalls(apiCalls);
      }

      return {};
    }

    const tipo: MessageType =
      preferredFormat === 'audio' ? MessageType.voice : MessageType.text;

    // 1. Enviar vía Evolution API
    let evolutionKeyId: string;
    if (tipo === MessageType.text) {
      const response = await this.evolutionService.sendTextMessage(
        instanceName,
        clientPhone,
        responseText,
      );
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

    this.logger.log(
      `Evolution accepted message for ${clientPhone}, keyId: ${evolutionKeyId}`,
    );

    // 2. Guardar en BD
    const messageData = buildOutgoingMessageData(
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

    const { message } = await this.internalApi.sendMessageTransaction(
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

    this.logger.log(
      `SendNode: message sent for ${conversationId} | type=${tipo} | cost=$${totalCost.toFixed(6)}`,
    );

    // 4. Verificar créditos
    const user = await this.internalApi.getUser(userId);
    if (user && user.creditsUsed > user.creditsLimit) {
      this.logger.warn(
        `Credits exceeded after processing for user ${userId}, conversation ${conversationId}`,
      );

      this.websocketGateway.emitCreditsExhausted(
        userId,
        conversationId,
        user.creditsUsed,
        user.creditsLimit,
      );
      await this.internalApi.updateConversationMode(conversationId, 'HITL');

      const activeSession =
        await this.sessionRepository.findActiveByConversationId(conversationId);
      if (activeSession) {
        await this.sessionRepository.close(
          activeSession.id,
          'credits_exhausted',
        );
      }

      await this.sessionRepository.createHitl(conversationId);
      this.logger.log(
        `SendNode: conversation ${conversationId} moved to HITL due to credits exhaustion`,
      );
    }

    // 5. Switch a HITL si el intent lo requiere
    if (intent === 'switch_hitl') {
      await this.internalApi.updateConversationMode(conversationId, 'HITL');

      const activeSession =
        await this.sessionRepository.findActiveByConversationId(conversationId);
      if (activeSession) {
        await this.sessionRepository.close(activeSession.id, 'client_request');
      }

      await this.sessionRepository.createHitl(conversationId);

      this.websocketGateway.emit(
        'conversation:hitl',
        {
          conversationId,
          clientPhone,
          timestamp: new Date().toISOString(),
        },
        userId,
      );

      this.logger.log(
        `SendNode: conversation ${conversationId} switched to HITL mode`,
      );
    }

    return {};
  }

  private mapTypeToMediaType(tipo: MessageType): EvolutionMediaType {
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
        throw new Error(`Unsupported media type: ${tipo}`);
    }
  }
}
