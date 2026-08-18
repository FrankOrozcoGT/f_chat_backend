import { Injectable, Logger } from '@nestjs/common';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { QwenSttClient } from '@common/external-integrations/qwen-stt.client';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import {
  AnalysisStateType,
  AnalysisMessage,
  AnalysisWarning,
} from '../analysis-state.interface';

@Injectable()
export class AnalysisInputRouterNode {
  private readonly logger = new Logger(AnalysisInputRouterNode.name);

  constructor(
    private readonly fileStorageService: FileStorageService,
    private readonly sttClient: QwenSttClient,
    private readonly limitsService: LimitsService,
    private readonly internalApi: InternalApiClient,
  ) {}

  async execute(
    state: AnalysisStateType,
  ): Promise<Partial<AnalysisStateType>> {
    const { messages, tenantId } = state;
    const processedMessages: AnalysisMessage[] = [];
    const warnings: AnalysisWarning[] = [];
    let totalCost = 0;

    for (const msg of messages) {
      if (
        (msg.type === 'voice' || msg.type === 'audio') &&
        !msg.transcription
      ) {
        // Necesita transcripción STT
        if (!msg.mediaUrl) {
          warnings.push({
            messageId: msg.id,
            type: 'stt_no_media',
            message: 'Audio message without media file, skipping STT',
          });
          processedMessages.push({
            ...msg,
            transcription: '[Audio sin archivo disponible]',
          });
          continue;
        }

        try {
          const audioBuffer = await this.fileStorageService.readFile(
            msg.mediaUrl,
          );
          const sttResult = await this.sttClient.transcribe(audioBuffer);

          // Guardar transcripción en DB
          await this.internalApi.updateTranscription(msg.id, sttResult.text);

          // Incrementar créditos
          const credits =
            this.limitsService.calculateCreditsFromSeconds(30);
          await this.internalApi.incrementCreditsUsed(tenantId, credits);

          totalCost += sttResult.costUsd;

          processedMessages.push({
            ...msg,
            transcription: sttResult.text,
          });

          this.logger.log(
            `AnalysisInputRouter: STT for ${msg.id}: "${sttResult.text.substring(0, 60)}"`,
          );
        } catch (error) {
          this.logger.error(
            `AnalysisInputRouter: STT failed for ${msg.id}: ${error.message}`,
          );
          warnings.push({
            messageId: msg.id,
            type: 'stt_failed',
            message: `STT failed: ${error.message}`,
          });
          processedMessages.push({
            ...msg,
            transcription: '[Transcripción fallida]',
          });
        }
      } else {
        // Texto, imagen, documento — o audio con transcripción existente
        const transcription =
          msg.transcription || msg.content || '[Mensaje sin contenido]';
        processedMessages.push({ ...msg, transcription });
      }
    }

    return { processedMessages, warnings, totalCost };
  }
}
