import { Injectable, Logger } from '@nestjs/common';
import {
  EvolutionService,
  EvolutionMediaType,
} from '@common/evolution/evolution.service';
import { AiRepository } from '../../repositories/ai.repository';
import { SessionLifecycleService } from '../../services/session-lifecycle.service';
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
    private readonly sessionLifecycle: SessionLifecycleService,
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
      await this.sessionLifecycle.switchToHitl({
        conversationId,
        reason: 'api_error',
        userId,
        clientPhone,
        extras: { apiName: error.apiName, errorMessage: error.message },
      });

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

      await this.sessionLifecycle.switchToHitl({
        conversationId,
        reason: 'credits_exhausted',
        userId,
        extras: { creditsUsed: user.creditsUsed, creditsLimit: user.creditsLimit },
      });
    }

    // 5. Switch a HITL si el intent lo requiere
    if (intent === 'switch_hitl') {
      await this.sessionLifecycle.switchToHitl({
        conversationId,
        reason: 'client_request',
        userId,
        clientPhone,
      });

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
