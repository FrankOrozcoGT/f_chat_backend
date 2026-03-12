import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageType } from '@prisma/client';
import { AiWorkflow } from './langgraph/workflow';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from './clients/internal-api.client';
import { SessionLifecycleService } from './services/session-lifecycle.service';
import { NodeSessionRepository } from '@modules/nodes/repositories/node-session.repository';
import { EvolutionService } from '@common/evolution/evolution.service';

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
    private readonly internalApi: InternalApiClient,
    private readonly sessionLifecycle: SessionLifecycleService,
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly evolutionService: EvolutionService,
  ) {}

  @OnEvent('ai.incoming.message')
  async handleIncomingMessage(payload: IncomingMessageEvent): Promise<void> {
    try {
      // Si la nodeSession está en waiting_queue, responder amablemente y no ejecutar workflow
      const nodeSession = await this.nodeSessionRepo.findActiveOrWaitingByConversationId(payload.conversationId);
      if (nodeSession?.status === 'waiting_queue') {
        if (payload.clientPhone && payload.instanceName) {
          const remoteJid = `${payload.clientPhone}@s.whatsapp.net`;
          await this.evolutionService.sendTextMessage(
            payload.instanceName,
            remoteJid,
            'Estoy verificando tu solicitud, en cuanto tenga respuesta te aviso 😊',
          );
        }
        this.logger.log(`[waiting_queue] Client message while waiting, sent friendly response for conversation ${payload.conversationId}`);
        return;
      }

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

        const user = await this.internalApi.getUser(payload.userId);

        await this.sessionLifecycle.switchToHitl({
          conversationId: payload.conversationId,
          reason: 'credits_exhausted',
          userId: payload.userId,
          extras: user
            ? { creditsUsed: user.creditsUsed, creditsLimit: user.creditsLimit }
            : undefined,
        });

        return;
      }

      this.logger.error(
        `AI processing failed for conversation ${payload.conversationId}: ${error.message}`,
      );
    }
  }
}
