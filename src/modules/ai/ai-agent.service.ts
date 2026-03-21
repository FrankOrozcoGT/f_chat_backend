import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageType } from '@prisma/client';
import { AiWorkflow } from './langgraph/workflow';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from './clients/internal-api.client';
import { SessionLifecycleService } from './services/session-lifecycle.service';
import { TestQueueResultStore } from '@modules/nodes/services/test-queue-result.store';

export interface IncomingMessageEvent {
  messageId: string;
  conversationId: string;
  instanceName: string;
  clientPhone: string;
  tenantId: string;
  messageType: MessageType;
  content: string | null;
  transcription?: string | null;
  mediaRelativePath: string | null;
  mediaMetadata: { fileName: string; mimeType: string } | null;
  isTest?: boolean;
  fromHitl?: boolean;
  conversationSummary?: string | null;
  queueContext?: string | null;
}

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(
    private readonly workflow: AiWorkflow,
    private readonly limitsService: LimitsService,
    private readonly internalApi: InternalApiClient,
    private readonly sessionLifecycle: SessionLifecycleService,
    private readonly testQueueResultStore: TestQueueResultStore,
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
        payload.tenantId,
        estimatedCredits,
      );

      const result = await this.workflow.execute(payload, payload.isTest ?? false);

      // In test mode, store the result so sendTest can pick it up via polling
      if (payload.isTest) {
        const sendMsg = result.sideEffects?.find((se) => se.action === 'sendMessage');
        const response = result.responseText || (sendMsg?.args?.mensaje as string) || '';
        this.testQueueResultStore.set(payload.conversationId, {
          response,
          intent: result.intent ?? '',
          currentNodeId: result.currentNodeId ?? null,
          sideEffects: result.sideEffects ?? [],
          preCodeContext: result.preCodeContext ?? null,
          nodeTransitions: result.nodeTransitions ?? [],
        });
        this.logger.log(`[test] Stored queue result for conversation ${payload.conversationId}`);
      }
    } catch (error) {
      // Si es error de límite de créditos, orquestar rechazo
      if (
        error instanceof ForbiddenException &&
        error.message.includes('Credits limit reached')
      ) {
        this.logger.warn(
          `Credits exhausted for user ${payload.tenantId}, conversation ${payload.conversationId}`,
        );

        const user = await this.internalApi.getUser(payload.tenantId);

        await this.sessionLifecycle.switchToHitl({
          conversationId: payload.conversationId,
          reason: 'credits_exhausted',
          tenantId: payload.tenantId,
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
