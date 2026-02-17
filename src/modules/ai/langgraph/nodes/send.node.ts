import { Injectable, Logger } from '@nestjs/common';
import { MessageSendService } from '@modules/messages/message-send.service';
import { AiRepository } from '../../repositories/ai.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { SessionRepository } from '../../repositories/session.repository';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { ApiHealthRepository } from '@modules/health/repositories/api-health.repository';
import { MessageType } from '@prisma/client';
import { WorkflowStateType } from '../state.interface';

@Injectable()
export class SendNode {
  private readonly logger = new Logger(SendNode.name);

  constructor(
    private readonly messageSendService: MessageSendService,
    private readonly aiRepository: AiRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly apiHealthRepository: ApiHealthRepository,
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
      // Marcar API como down
      await this.apiHealthRepository.markAsDown(error.apiName, error.message);

      // Activar HITL automáticamente
      await this.conversationRepository.updateMode(conversationId, 'HITL');

      const activeSession = await this.sessionRepository.findActiveByConversationId(conversationId);
      if (activeSession) {
        await this.sessionRepository.close(activeSession.id, 'api_error');
      }

      await this.sessionRepository.createHitl(conversationId);

      // Emitir WebSocket: api:down + conversation:hitl
      this.websocketGateway.emitApiDown(error.apiName, error.message, userId);
      this.websocketGateway.emit('conversation:hitl', {
        conversationId,
        clientPhone,
        reason: 'api_error',
        apiName: error.apiName,
        timestamp: new Date().toISOString(),
      }, userId);

      this.logger.warn(`SendNode: API error (${error.apiName}) → HITL activated for ${conversationId}`);

      // Guardar api calls acumulados hasta el error
      if (apiCalls.length > 0) {
        await this.aiRepository.saveApiCalls(apiCalls);
      }

      return {};
    }

    const tipo: MessageType = preferredFormat === 'audio' ? MessageType.voice : MessageType.text;

    const message = await this.messageSendService.send({
      conversationId,
      userId,
      instanceId: instanceName,
      clientPhone,
      tipo,
      contenido: responseText,
      relativePath: responseMediaRelativePath,
      mediaUrlForEvolution: responseMediaUrl,
      mimeType: responseMimeType || undefined,
      fileName: responseFileName || undefined,
      fileSize: responseFileSize || undefined,
      senderType: 'bot',
    });

    // Save API calls
    if (apiCalls.length > 0) {
      await this.aiRepository.saveApiCalls(apiCalls);
    }

    // Save total cost on the message
    await this.aiRepository.saveMessage(message.id, totalCost);

    this.logger.log(`SendNode: message sent for ${conversationId} | type=${tipo} | cost=$${totalCost.toFixed(6)}`);

    // Switch to HITL if intent requires it
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
}
