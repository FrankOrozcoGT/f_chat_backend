import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { QwenSttClient } from '../../clients/qwen-stt.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';

@Injectable()
export class InputRouterNode {
  private readonly logger = new Logger(InputRouterNode.name);

  constructor(
    private readonly fileStorageService: FileStorageService,
    private readonly sttClient: QwenSttClient,
    private readonly langSmithService: LangSmithService,
    private readonly limitsService: LimitsService,
    private readonly internalApi: InternalApiClient,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const {
      messageType,
      content,
      mediaRelativePath,
      mediaMetadata,
      messageId,
      conversationId,
    } = state;
    const apiCalls: CreateApiCallData[] = [];

    if (
      messageType === MessageType.voice ||
      messageType === MessageType.audio
    ) {
      // Reusar transcripción existente si ya fue procesada
      const existingMessage = await this.internalApi.getMessage(messageId);
      if (existingMessage?.transcription) {
        this.logger.log(
          `InputRouter: audio → reusing existing transcription: "${existingMessage.transcription.substring(0, 80)}"`,
        );
        return {
          transcription: existingMessage.transcription,
          apiCalls,
          totalCost: 0,
        };
      }

      if (!mediaRelativePath) {
        throw new Error('Audio message without mediaRelativePath');
      }

      const audioBuffer =
        await this.fileStorageService.readFile(mediaRelativePath);

      // Obtener userId para tracking de créditos (sin validación)
      const conversation =
        await this.internalApi.getConversation(conversationId);
      if (!conversation) {
        return {
          error: {
            step: 'input_router',
            apiName: 'qwen_stt',
            message: 'Conversation not found',
          },
          apiCalls,
          totalCost: 0,
        };
      }
      const userId = conversation.phone.userId;
      const estimatedDurationSeconds = 30; // Para incremento posterior

      try {
        const sttResult = await this.langSmithService.traceSTT(() =>
          this.sttClient.transcribe(audioBuffer),
        );

        apiCalls.push({
          messageId,
          apiType: 'qwen_stt',
          operation: 'transcribe',
          costUsd: sttResult.costUsd,
          latencyMs: sttResult.latencyMs,
        });

        // Guardar transcripción en DB para reutilización futura
        await this.internalApi.updateTranscription(messageId, sttResult.text);

        // Incrementar créditos usados basado en duración estimada
        const actualCredits = this.limitsService.calculateCreditsFromSeconds(
          estimatedDurationSeconds,
        );
        await this.internalApi.incrementCreditsUsed(userId, actualCredits);

        this.logger.log(
          `InputRouter: audio → STT transcription: "${sttResult.text.substring(0, 80)}"`,
        );

        return {
          transcription: sttResult.text,
          apiCalls,
          totalCost: sttResult.costUsd,
        };
      } catch (error) {
        this.logger.error(`InputRouter: STT failed: ${error.message}`);
        return {
          error: {
            step: 'input_router',
            apiName: 'qwen_stt',
            message: error.message,
          },
          apiCalls,
          totalCost: 0,
        };
      }
    }

    if (messageType === MessageType.text) {
      this.logger.log(`InputRouter: text pass-through`);

      return {
        transcription: content || '',
        apiCalls,
        totalCost: 0,
      };
    }

    if (messageType === MessageType.image) {
      const caption = content || '';
      let imageUrl: string | null = null;

      if (mediaRelativePath) {
        const imageBuffer =
          await this.fileStorageService.readFile(mediaRelativePath);
        const mimeType = mediaMetadata?.mimeType || 'image/jpeg';
        const base64 = imageBuffer.toString('base64');
        imageUrl = `data:${mimeType};base64,${base64}`;
        this.logger.log(
          `InputRouter: image → base64 data URI (${Math.round(base64.length / 1024)}KB), caption="${caption.substring(0, 80)}"`,
        );
      }

      return {
        transcription: caption || 'El usuario envió una imagen.',
        imageUrl,
        apiCalls,
        totalCost: 0,
      };
    }

    // media (document, video, etc.)
    const fileName = mediaMetadata?.fileName || 'unknown';
    const transcription = `Usuario envió documento: ${fileName}`;
    this.logger.log(`InputRouter: media → metadata: ${transcription}`);

    return {
      transcription,
      apiCalls,
      totalCost: 0,
    };
  }
}
