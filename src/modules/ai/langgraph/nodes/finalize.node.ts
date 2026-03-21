import { Injectable, Logger } from '@nestjs/common';
import { AiRepository } from '../../repositories/ai.repository';
import { SessionLifecycleService } from '../../services/session-lifecycle.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { TestSideEffect } from '../../../nodes/functions/node-function.context';
import { QUEUE_RESUME_MESSAGE_PREFIX } from '../../../queue-system/services/queue-resume.service';

@Injectable()
export class FinalizeNode {
  private readonly logger = new Logger(FinalizeNode.name);

  constructor(
    private readonly aiRepository: AiRepository,
    private readonly sessionLifecycle: SessionLifecycleService,
    private readonly internalApi: InternalApiClient,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const {
      conversationId,
      tenantId,
      clientPhone,
      apiCalls,
      totalCost,
      error,
      isTest,
      sideEffects: existingSideEffects,
    } = state;

    const sideEffects: TestSideEffect[] = [];

    this.logger.log(`FinalizeNode: isTest=${isTest} apiCalls=${apiCalls.length}`);

    // Si hubo error en un node anterior → notificar al cliente y activar HITL
    if (error) {
      const isApiError = 'apiName' in error;
      if (isTest) {
        sideEffects.push({ action: 'switchToHitl', args: { reason: isApiError ? 'api_error' : 'config_error', ...(isApiError && { apiName: error.apiName }), errorMessage: error.message } });
        this.logger.warn(`FinalizeNode [TEST]: ${isApiError ? 'API' : 'Config'} error${isApiError ? ` (${error.apiName})` : ''} → HITL registered`);
      } else {
        await this.sessionLifecycle.switchToHitl({
          conversationId,
          reason: isApiError ? 'api_error' : 'config_error',
          tenantId,
          clientPhone,
          extras: isApiError ? { apiName: error.apiName, errorMessage: error.message } : undefined,
        });
        this.logger.warn(`FinalizeNode: ${isApiError ? 'API' : 'Config'} error${isApiError ? ` (${error.apiName})` : ''} → HITL activated for ${conversationId}`);
      }

      const saveable = apiCalls.filter((c) => !c.messageId.startsWith(QUEUE_RESUME_MESSAGE_PREFIX));
      if (!isTest && saveable.length > 0) {
        await this.aiRepository.saveApiCalls(saveable);
      }

      return {
        sideEffects: [...(existingSideEffects || []), ...sideEffects],
      };
    }

    // Guardar API calls (skip en test mode)
    const saveable = apiCalls.filter((c) => !c.messageId.startsWith(QUEUE_RESUME_MESSAGE_PREFIX));
    if (!isTest && saveable.length > 0) {
      await this.aiRepository.saveApiCalls(saveable);
    }

    // Verificar créditos
    const user = await this.internalApi.getUser(tenantId);
    if (user && user.creditsUsed > user.creditsLimit) {
      if (isTest) {
        sideEffects.push({ action: 'switchToHitl', args: { reason: 'credits_exhausted', creditsUsed: user.creditsUsed, creditsLimit: user.creditsLimit } });
        this.logger.warn(`FinalizeNode [TEST]: Credits exceeded → HITL registered`);
      } else {
        this.logger.warn(
          `Credits exceeded after processing for user ${tenantId}, conversation ${conversationId}`,
        );
        await this.sessionLifecycle.switchToHitl({
          conversationId,
          reason: 'credits_exhausted',
          tenantId,
          extras: { creditsUsed: user.creditsUsed, creditsLimit: user.creditsLimit },
        });
      }
    }

    this.logger.log(
      `FinalizeNode: completed for ${conversationId} | cost=$${totalCost.toFixed(6)}${isTest ? ' [TEST]' : ''}`,
    );

    return {
      sideEffects: [...(existingSideEffects || []), ...sideEffects],
    };
  }
}
