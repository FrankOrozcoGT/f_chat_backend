import { Injectable, Logger } from '@nestjs/common';
import { QwenTtsClient } from '../../clients/qwen-tts.client';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';

@Injectable()
export class OutputRouterNode {
  private readonly logger = new Logger(OutputRouterNode.name);

  constructor(
    private readonly ttsClient: QwenTtsClient,
    private readonly fileStorageService: FileStorageService,
    private readonly langSmithService: LangSmithService,
    private readonly limitsService: LimitsService,
    private readonly internalApi: InternalApiClient,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const {
      preferredFormat,
      responseText,
      tenantId,
      conversationId,
      messageId,
      apiCalls: existingApiCalls,
      totalCost: existingCost,
      error: previousError,
    } = state;

    // Si un node anterior falló o no hay texto que procesar, skip
    if (previousError || !responseText) return {};

    if (preferredFormat === 'text') {
      this.logger.log(`OutputRouter: text → pass-through`);
      return {
        responseMediaRelativePath: null,
        responseMediaUrl: null,
        responseMimeType: null,
        responseFileName: null,
        responseFileSize: null,
      };
    }

    // NO validar créditos - permitir que TTS se ejecute aunque quede en negativo

    // audio: TTS + save file
    try {
      const ttsResult = await this.langSmithService.traceTTS(() =>
        this.ttsClient.synthesize(responseText),
      );

      const apiCall: CreateApiCallData = {
        messageId,
        apiType: 'qwen_tts',
        operation: 'synthesize',
        costUsd: ttsResult.costUsd,
        latencyMs: ttsResult.latencyMs,
      };

      // Incrementar créditos usados basado en longitud del texto
      const actualCredits = this.limitsService.calculateCreditsFromChars(
        responseText.length,
      );
      await this.internalApi.incrementCreditsUsed(tenantId, actualCredits);

      const { randomUUID } = await import('crypto');
      const responseMessageId = randomUUID();

      const savedFile = await this.fileStorageService.saveBuffer(
        ttsResult.audioBuffer,
        tenantId,
        conversationId,
        responseMessageId,
        '.ogg',
        'audio/ogg',
      );

      const mediaUrl = this.fileStorageService.buildDockerAccessibleUrl(
        savedFile.relativePath,
      );

      this.logger.log(
        `OutputRouter: audio → TTS + saved ${savedFile.relativePath}`,
      );

      return {
        responseMediaRelativePath: savedFile.relativePath,
        responseMediaUrl: mediaUrl,
        responseMimeType: savedFile.mimeType,
        responseFileName: savedFile.fileName,
        responseFileSize: savedFile.fileSize,
        apiCalls: [...existingApiCalls, apiCall],
        totalCost: existingCost + ttsResult.costUsd,
      };
    } catch (error) {
      this.logger.error(`OutputRouter: TTS failed: ${error.message}`);
      // TTS falla pero tenemos responseText → fallback a texto
      this.logger.warn(`OutputRouter: falling back to text response`);
      return {
        preferredFormat: 'text',
        responseMediaRelativePath: null,
        responseMediaUrl: null,
        responseMimeType: null,
        responseFileName: null,
        responseFileSize: null,
      };
    }
  }
}
