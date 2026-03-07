import { Injectable, Logger } from '@nestjs/common';
import { SessionRepository } from '../repositories/session.repository';
import { InternalApiClient } from '../clients/internal-api.client';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';

export interface SwitchToHitlParams {
  conversationId: string;
  reason: 'api_error' | 'credits_exhausted' | 'client_request' | 'manual_takeover';
  userId: string;
  clientPhone?: string;
  extras?: {
    apiName?: string;
    errorMessage?: string;
    userName?: string;
    creditsUsed?: number;
    creditsLimit?: number;
  };
}

export interface CloseConversationParams {
  conversationId: string;
  sessionId: string;
}

export interface ReturnToAiParams {
  conversationId: string;
  userId: string;
}

@Injectable()
export class SessionLifecycleService {
  private readonly logger = new Logger(SessionLifecycleService.name);

  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly internalApi: InternalApiClient,
    private readonly websocketGateway: AppWebSocketGateway,
  ) {}

  async switchToHitl(params: SwitchToHitlParams): Promise<void> {
    const { conversationId, reason, userId, clientPhone, extras } = params;

    // 1. Mark API down if api_error
    if (reason === 'api_error' && extras?.apiName) {
      await this.internalApi.markApiDown(extras.apiName, extras.errorMessage || 'Unknown error');
    }

    // 2. Update conversation mode to HITL
    await this.internalApi.updateConversationMode(conversationId, 'HITL');

    // 3. Close active AI session if exists
    const activeSession = await this.sessionRepository.findActiveByConversationId(conversationId);
    if (activeSession) {
      await this.sessionRepository.close(
        activeSession.id,
        reason,
        reason === 'manual_takeover' ? userId : undefined,
      );
    }

    // 4. Create HITL session
    await this.sessionRepository.createHitl(
      conversationId,
      reason === 'manual_takeover' ? userId : undefined,
    );

    // 5. Emit WebSocket events based on reason
    switch (reason) {
      case 'api_error':
        this.websocketGateway.emitApiDown(extras?.apiName || 'unknown', extras?.errorMessage || 'Unknown error', userId);
        this.websocketGateway.emit(
          'conversation:hitl',
          {
            conversationId,
            clientPhone,
            reason: 'api_error',
            apiName: extras?.apiName,
            timestamp: new Date().toISOString(),
          },
          userId,
        );
        break;

      case 'credits_exhausted':
        if (extras?.creditsUsed !== undefined && extras?.creditsLimit !== undefined) {
          this.websocketGateway.emitCreditsExhausted(userId, conversationId, extras.creditsUsed, extras.creditsLimit);
        }
        break;

      case 'client_request':
        this.websocketGateway.emit(
          'conversation:hitl',
          {
            conversationId,
            clientPhone,
            timestamp: new Date().toISOString(),
          },
          userId,
        );
        break;

      case 'manual_takeover':
        this.websocketGateway.emit(
          'conversation:taken',
          {
            conversationId,
            userId,
            userName: extras?.userName,
            timestamp: new Date().toISOString(),
          },
          userId,
        );
        break;
    }

    this.logger.log(`switchToHitl: ${conversationId} → reason=${reason}`);
  }

  async closeConversation(params: CloseConversationParams): Promise<void> {
    const { conversationId, sessionId } = params;

    await this.sessionRepository.close(sessionId, 'end_conversation');

    this.logger.log(`closeConversation: ${conversationId}, session=${sessionId}`);
  }

  async returnToAi(params: ReturnToAiParams): Promise<void> {
    const { conversationId, userId } = params;

    // 1. Update conversation mode to AI
    await this.internalApi.updateConversationMode(conversationId, 'AI');

    // 2. Close active HITL session if exists
    const activeSession = await this.sessionRepository.findActiveHitlByConversationId(conversationId);
    if (activeSession) {
      await this.sessionRepository.close(activeSession.id, 'returned_to_ai', userId);
    }

    // 3. Create new AI session
    await this.sessionRepository.create(conversationId);

    // 4. Emit WS
    this.websocketGateway.emit(
      'conversation:returned',
      {
        conversationId,
        timestamp: new Date().toISOString(),
      },
      userId,
    );

    this.logger.log(`returnToAi: ${conversationId}`);
  }
}
