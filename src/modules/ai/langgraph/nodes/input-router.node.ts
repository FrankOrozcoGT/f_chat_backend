import { Injectable, Logger } from '@nestjs/common';
import { ApiName, MessageType } from '@prisma/client';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { QwenSttClient } from '../../clients/qwen-stt.client';
import { LangSmithService } from '@common/langsmith/langsmith.service';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '../../clients/internal-api.client';
import { WorkflowStateType } from '../state.interface';
import { CreateApiCallData } from '../../repositories/ai.repository';
import { NodeSessionRepository } from '@modules/nodes/repositories/node-session.repository';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { RedisService } from '@common/redis/redis.service';
import { DbNodeSessionStore } from '@modules/nodes/stores/db-node-session.store';
import { RedisNodeSessionStore } from '@modules/nodes/stores/redis-node-session.store';
import { ImageService } from '@common/image/image.service';

@Injectable()
export class InputRouterNode {
  private readonly logger = new Logger(InputRouterNode.name);

  constructor(
    private readonly fileStorageService: FileStorageService,
    private readonly sttClient: QwenSttClient,
    private readonly langSmithService: LangSmithService,
    private readonly limitsService: LimitsService,
    private readonly internalApi: InternalApiClient,
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly nodeRepo: NodeRepository,
    private readonly redisService: RedisService,
    private readonly imageService: ImageService,
  ) {}

  async execute(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const {
      messageType,
      content,
      mediaRelativePath,
      mediaMetadata,
      messageId,
      conversationId,
      isTest,
    } = state;
    const apiCalls: CreateApiCallData[] = [];

    this.logger.log(`InputRouter: isTest=${isTest} messageId=${messageId}`);
    const sessionStore = isTest
      ? new RedisNodeSessionStore(this.redisService, this.nodeRepo)
      : new DbNodeSessionStore(this.nodeSessionRepo);

    if (
      messageType === MessageType.voice ||
      messageType === MessageType.audio
    ) {
      // Reusar transcripción si ya viene en el state (ej: del análisis previo en hitl.return)
      if (state.transcription) {
        this.logger.log(
          `InputRouter: audio → reusing transcription from state: "${state.transcription.substring(0, 80)}"`,
        );
        return {
          sessionStore,
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
          error: { message: 'Conversation not found' },
          sessionStore,
          apiCalls,
          totalCost: 0,
        };
      }
      const tenantId = conversation.phone.tenantId;
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
        await this.internalApi.incrementCreditsUsed(tenantId, actualCredits);

        this.logger.log(
          `InputRouter: audio → STT transcription: "${sttResult.text.substring(0, 80)}"`,
        );

        return {
          transcription: sttResult.text,
          sessionStore,
          apiCalls,
          totalCost: sttResult.costUsd,
        };
      } catch (error) {
        this.logger.error(`InputRouter: STT failed: ${error.message}`);
        return {
          error: {
            apiName: ApiName.qwen_stt,
            message: error.message,
          },
          sessionStore,
          apiCalls,
          totalCost: 0,
        };
      }
    }

    if (messageType === MessageType.text) {
      this.logger.log(`InputRouter: text pass-through`);

      return {
        transcription: content || '',
        sessionStore,
        apiCalls,
        totalCost: 0,
      };
    }

    if (messageType === MessageType.image) {
      const caption = content || '';
      let imageUrl: string | null = null;

      if (mediaRelativePath) {
        try {
          const rawBuffer = await this.fileStorageService.readFile(mediaRelativePath.replace(/^\//, ''));
          const originalMimeType = mediaMetadata?.mimeType || 'image/jpeg';
          const { buffer: imageBuffer, mimeType } = await this.imageService.compressForLlm(rawBuffer, originalMimeType);
          const base64 = imageBuffer.toString('base64');
          imageUrl = `data:${mimeType};base64,${base64}`;
          this.logger.log(
            `InputRouter: image → ${Math.round(base64.length / 1024)}KB, caption="${caption.substring(0, 80)}"`,
          );
        } catch (err) {
          this.logger.warn(`InputRouter: image not found (${mediaRelativePath}): ${err.message}`);
        }
      }

      return {
        transcription: imageUrl ? (caption || 'El usuario envió una imagen.') : (caption || '[imagen no disponible]'),
        imageUrl,
        sessionStore,
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
      sessionStore,
      apiCalls,
      totalCost: 0,
    };
  }
}
