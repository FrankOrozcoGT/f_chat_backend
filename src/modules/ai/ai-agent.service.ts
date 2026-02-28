import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageType } from '@prisma/client';
import { AiWorkflow } from './langgraph/workflow';
import { LimitsService } from '@common/services/limits.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { InternalApiClient } from './clients/internal-api.client';
import { SessionRepository } from './repositories/session.repository';

export interface IncomingMessageEvent {
  messageId: string;
  conversationId: string;
  instanceName: string;
  clientPhone: string;
  userId: string;
  messageType: MessageType;
  content: string | null;
  mediaRelativePath: string | null;
  mediaMetadata: { fileName: string; mimeType: string } | null;
}

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(
    private readonly workflow: AiWorkflow,
    private readonly limitsService: LimitsService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly internalApi: InternalApiClient,
    private readonly sessionRepository: SessionRepository,
  ) {}

  @OnEvent('ai.incoming.message')
  async handleIncomingMessage(payload: IncomingMessageEvent): Promise<void> {
    try {
      // Validar créditos ANTES de ejecutar el workflow
      // Estimación conservadora: STT (30s) + LLM (500 tokens) = ~0.65 créditos
      const estimatedCredits =
        payload.messageType === MessageType.voice ||
        payload.messageType === MessageType.audio
          ? this.limitsService.calculateCreditsFromSeconds(30) +
            this.limitsService.calculateCreditsFromTokens(500)
          : this.limitsService.calculateCreditsFromTokens(500);

      await this.limitsService.validateCredits(
        payload.userId,
        estimatedCredits,
      );

      // Si pasa la validación, ejecutar workflow
      await this.workflow.execute(payload);
    } catch (error) {
      // Si es error de límite de créditos, orquestar rechazo
      if (
        error instanceof ForbiddenException &&
        error.message.includes('Credits limit reached')
      ) {
        this.logger.warn(
          `Credits exhausted for user ${payload.userId}, conversation ${payload.conversationId}`,
        );

        // Obtener datos actuales del usuario para emitir WebSocket
        const user = await this.internalApi.getUser(payload.userId);
        if (user) {
          this.websocketGateway.emitCreditsExhausted(
            payload.userId,
            payload.conversationId,
            user.creditsUsed,
            user.creditsLimit,
          );
        }

        // Cambiar conversación a HITL
        await this.internalApi.updateConversationMode(
          payload.conversationId,
          'HITL',
        );

        // Cerrar sesión AI activa si existe
        const activeSession =
          await this.sessionRepository.findActiveByConversationId(
            payload.conversationId,
          );
        if (activeSession) {
          await this.sessionRepository.close(
            activeSession.id,
            'credits_exhausted',
          );
        }

        // Crear sesión HITL
        await this.sessionRepository.createHitl(payload.conversationId);

        this.logger.log(
          `Conversation ${payload.conversationId} moved to HITL due to credits exhaustion`,
        );
        return;
      }

      this.logger.error(
        `AI processing failed for conversation ${payload.conversationId}: ${error.message}`,
      );
    }
  }
}
