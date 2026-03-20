import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionRepository } from '../repositories/session.repository';
import { InternalApiClient } from '../clients/internal-api.client';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { NodeSessionRepository } from '@modules/nodes/repositories/node-session.repository';

export interface SwitchToHitlParams {
  conversationId: string;
  reason: 'api_error' | 'credits_exhausted' | 'client_request' | 'manual_takeover' | 'hacking';
  tenantId: string;
  clientPhone?: string;
  extras?: {
    apiName?: string;
    errorMessage?: string;
    userName?: string;
    creditsUsed?: number;
    creditsLimit?: number;
  };
}

export interface ReturnToAiParams {
  conversationId: string;
  tenantId: string;
  messages: { id: string; direction: string; type: string; content: string | null; mediaUrl?: string | null; fileName?: string | null; mimeType?: string | null }[];
}

@Injectable()
export class SessionLifecycleService {
  private readonly logger = new Logger(SessionLifecycleService.name);

  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly internalApi: InternalApiClient,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly nodeSessionRepository: NodeSessionRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async switchToHitl(params: SwitchToHitlParams): Promise<void> {
    const { conversationId, reason, tenantId, clientPhone, extras } = params;

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
        reason === 'manual_takeover' ? tenantId : undefined,
      );
    }

    // 4. Create HITL session
    await this.sessionRepository.createHitl(
      conversationId,
      reason === 'manual_takeover' ? tenantId : undefined,
    );

    // 5. Emit WebSocket events based on reason
    switch (reason) {
      case 'api_error':
        this.websocketGateway.emitApiDown(extras?.apiName || 'unknown', extras?.errorMessage || 'Unknown error', tenantId);
        this.websocketGateway.emit(
          'conversation:hitl',
          {
            conversationId,
            clientPhone,
            reason: 'api_error',
            apiName: extras?.apiName,
            timestamp: new Date().toISOString(),
          },
          tenantId,
        );
        break;

      case 'credits_exhausted':
        if (extras?.creditsUsed !== undefined && extras?.creditsLimit !== undefined) {
          this.websocketGateway.emitCreditsExhausted(tenantId, conversationId, extras.creditsUsed, extras.creditsLimit);
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
          tenantId,
        );
        break;

      case 'manual_takeover':
        this.websocketGateway.emit(
          'conversation:taken',
          {
            conversationId,
            tenantId,
            userName: extras?.userName,
            timestamp: new Date().toISOString(),
          },
          tenantId,
        );
        break;

      case 'hacking':
        this.websocketGateway.emit(
          'conversation:hitl',
          {
            conversationId,
            clientPhone,
            reason: 'hacking',
            errorMessage: extras?.errorMessage,
            timestamp: new Date().toISOString(),
          },
          tenantId,
        );
        break;
    }

    this.logger.log(`switchToHitl: ${conversationId} → reason=${reason}`);
  }

  async returnToAi(params: ReturnToAiParams): Promise<void> {
    const { conversationId, tenantId, messages } = params;

    // 1. Update conversation mode to AI
    await this.internalApi.updateConversationMode(conversationId, 'AI');

    // 2. Close active HITL session if exists
    const activeSession = await this.sessionRepository.findActiveHitlByConversationId(conversationId);
    if (activeSession) {
      await this.sessionRepository.close(activeSession.id, 'returned_to_ai', tenantId);
    }

    // 3. Close active nodeSession so intent_router starts fresh (no currentNodeId)
    const activeNodeSession = await this.nodeSessionRepository.findActiveOrWaitingByConversationId(conversationId);
    if (activeNodeSession) {
      await this.nodeSessionRepository.close(activeNodeSession.id);
    }

    // 4. Create new AI session
    await this.sessionRepository.create(conversationId);

    // 5. Emit WS
    this.websocketGateway.emit(
      'conversation:returned',
      { conversationId, timestamp: new Date().toISOString() },
      tenantId,
    );

    // 6. Dispatch AI processing based on message state
    const messageCount = messages.length;

    const lastMessage = messages[messages.length - 1];

    if (messageCount <= 1) {
      if (lastMessage?.direction === 'incoming') {
        // Single client message → trigger listener
        this.eventEmitter.emit('ai.hitl.return', {
          conversationId,
          tenantId,
          messageCount,
          lastMessageDirection: lastMessage.direction,
          lastMessage,
        });
      }
      // Single outgoing message → do nothing, wait for client
    } else {
      // >1 messages → always trigger listener
      this.eventEmitter.emit('ai.hitl.return', {
        conversationId,
        tenantId,
        messageCount,
        lastMessageDirection: lastMessage.direction,
        lastMessage,
      });
    }

    this.logger.log(`returnToAi: ${conversationId}`);
  }
}
