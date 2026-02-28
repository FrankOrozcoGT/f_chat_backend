import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiName } from '@prisma/client';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly websocketGateway: AppWebSocketGateway,
  ) {}

  /**
   * Hace un HTTP ping simple a la API externa para verificar si está UP
   * @param apiName - Nombre de la API (qwen_stt, kimi_llm, qwen_tts)
   * @returns { isUp: boolean, responseTimeMs?: number, error?: string }
   */
  async pingAPI(apiName: ApiName): Promise<{
    isUp: boolean;
    responseTimeMs?: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      const url = this.getApiUrl(apiName);

      this.logger.debug(`[HealthService] Pinging ${apiName} at ${url}`);

      // HTTP HEAD request simple (no body, solo verificar que responda)
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      const responseTimeMs = Date.now() - startTime;

      // Considerar UP si responde con cualquier código 2xx, 4xx (auth issues OK)
      const isUp = response.status < 500;

      if (isUp) {
        this.logger.log(
          `[HealthService] ${apiName} is UP (${response.status}) - ${responseTimeMs}ms`,
        );
      } else {
        this.logger.warn(
          `[HealthService] ${apiName} returned ${response.status} - ${responseTimeMs}ms`,
        );
      }

      return {
        isUp,
        responseTimeMs,
        error: isUp ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      this.logger.error(
        `[HealthService] ${apiName} ping failed: ${error.message} (${responseTimeMs}ms)`,
      );

      return {
        isUp: false,
        responseTimeMs,
        error: error.message,
      };
    }
  }

  /**
   * Notifica a clientes afectados por la recuperación de una API
   * Busca conversaciones que tuvieron errores de esta API y les notifica vía WebSocket
   * @param apiName - Nombre de la API que se recuperó
   */
  async notifyAffectedClients(apiName: ApiName): Promise<void> {
    this.logger.log(
      `[HealthService] Notifying affected clients about ${apiName} recovery`,
    );

    // TODO: Implementar búsqueda de conversaciones afectadas
    // Requiere:
    // 1. Buscar en sessions con closeReason que contenga apiName
    // 2. Obtener conversationId → phoneId → userId
    // 3. Emitir evento WebSocket a cada userId único

    // Por ahora, emitir broadcast a todos los admins/usuarios conectados
    this.websocketGateway.emit('api:recovery', {
      apiName,
      message: `API ${apiName} has recovered and is now operational`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Obtiene la URL base de una API según su nombre
   */
  private getApiUrl(apiName: ApiName): string {
    switch (apiName) {
      case 'qwen_stt':
        return this.configService.get<string>(
          'QWEN_STT_API_URL',
          'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        );
      case 'kimi_llm':
        return this.configService.get<string>(
          'KIMI_API_URL',
          'https://api.moonshot.ai/v1/chat/completions',
        );
      case 'qwen_tts':
        return this.configService.get<string>(
          'QWEN_TTS_API_URL',
          'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-to-speech/synthesis',
        );
      default:
        throw new Error(`Unknown API name: ${apiName}`);
    }
  }
}
