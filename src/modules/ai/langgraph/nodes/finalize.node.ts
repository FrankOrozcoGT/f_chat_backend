import { Injectable, Logger } from '@nestjs/common';
import { AiRepository } from '../../repositories/ai.repository';
import { SessionLifecycleService } from '../../services/session-lifecycle.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { TestSideEffect } from '../../../nodes/functions/node-function.context';

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
      userId,
      clientPhone,
      apiCalls,
      totalCost,
      error,
      isTest,
      sideEffects: existingSideEffects,
    } = state;

    const sideEffects: TestSideEffect[] = [];

    // Si hubo error en un node anterior → notificar al cliente y activar HITL
    if (error) {
      if (isTest) {
        sideEffects.push({ action: 'switchToHitl', args: { reason: 'api_error', apiName: error.apiName, errorMessage: error.message } });
        this.logger.warn(`FinalizeNode [TEST]: API error (${error.apiName}) → HITL registered`);
      } else {
        await this.sessionLifecycle.switchToHitl({
          conversationId,
          reason: 'api_error',
          userId,
          clientPhone,
          extras: { apiName: error.apiName, errorMessage: error.message },
        });
        this.logger.warn(`FinalizeNode: API error (${error.apiName}) → HITL activated for ${conversationId}`);
      }

      if (!isTest && apiCalls.length > 0) {
        await this.aiRepository.saveApiCalls(apiCalls);
      }

      return {
        sideEffects: [...(existingSideEffects || []), ...sideEffects],
      };
    }

    // Guardar API calls (skip en test mode)
    if (!isTest && apiCalls.length > 0) {
      await this.aiRepository.saveApiCalls(apiCalls);
    }

    // Verificar créditos
    const user = await this.internalApi.getUser(userId);
    if (user && user.creditsUsed > user.creditsLimit) {
      if (isTest) {
        sideEffects.push({ action: 'switchToHitl', args: { reason: 'credits_exhausted', creditsUsed: user.creditsUsed, creditsLimit: user.creditsLimit } });
        this.logger.warn(`FinalizeNode [TEST]: Credits exceeded → HITL registered`);
      } else {
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
    }

    this.logger.log(
      `FinalizeNode: completed for ${conversationId} | cost=$${totalCost.toFixed(6)}${isTest ? ' [TEST]' : ''}`,
    );

    return {
      sideEffects: [...(existingSideEffects || []), ...sideEffects],
    };
  }
}
