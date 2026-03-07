import { Injectable, Logger } from '@nestjs/common';
import { AiRepository } from '../../repositories/ai.repository';
import { SessionLifecycleService } from '../../services/session-lifecycle.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';

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
      intent,
      error,
    } = state;

    // Si hubo error en un node anterior → notificar al cliente y activar HITL
    if (error) {
      await this.sessionLifecycle.switchToHitl({
        conversationId,
        reason: 'api_error',
        userId,
        clientPhone,
        extras: { apiName: error.apiName, errorMessage: error.message },
      });

      this.logger.warn(
        `FinalizeNode: API error (${error.apiName}) → HITL activated for ${conversationId}`,
      );

      if (apiCalls.length > 0) {
        await this.aiRepository.saveApiCalls(apiCalls);
      }

      return {};
    }

    // Guardar API calls
    if (apiCalls.length > 0) {
      await this.aiRepository.saveApiCalls(apiCalls);
    }

    // Verificar créditos
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

    // Switch a HITL si el intent lo requiere
    if (intent === 'switch_hitl') {
      await this.sessionLifecycle.switchToHitl({
        conversationId,
        reason: 'client_request',
        userId,
        clientPhone,
      });

      this.logger.log(
        `FinalizeNode: conversation ${conversationId} switched to HITL mode`,
      );
    }

    this.logger.log(
      `FinalizeNode: completed for ${conversationId} | cost=$${totalCost.toFixed(6)}`,
    );

    return {};
  }
}
