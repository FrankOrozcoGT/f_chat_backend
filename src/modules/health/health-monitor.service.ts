import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiHealthRepository } from './repositories/api-health.repository';
import { HealthService } from './health.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';

@Injectable()
export class HealthMonitorService {
  private readonly logger = new Logger(HealthMonitorService.name);

  constructor(
    private readonly apiHealthRepository: ApiHealthRepository,
    private readonly healthService: HealthService,
    private readonly websocketGateway: AppWebSocketGateway,
  ) {}

  /**
   * Cron job que ejecuta cada 30 minutos
   * Solo ejecuta si hay APIs con monitoringActive=true (zero overhead cuando todo UP)
   */
  @Cron('*/30 * * * *', {
    name: 'check-apis-health',
  })
  async checkAPIs() {

    try {
      // Obtener solo APIs que están siendo monitoreadas (monitoringActive=true)
      const apisToMonitor = await this.apiHealthRepository.getAPIsToMonitor();

      if (apisToMonitor.length === 0) {
        this.logger.debug(
          '[Cron] No APIs to monitor (all UP or none down) - skipping',
        );
        return;
      }

      this.logger.log(
        `[Cron] Monitoring ${apisToMonitor.length} API(s): ${apisToMonitor.map((a) => a.apiName).join(', ')}`,
      );

      // Verificar cada API down
      for (const apiHealth of apisToMonitor) {
        const { apiName } = apiHealth;


        // Ping a la API
        const pingResult = await this.healthService.pingAPI(apiName);

        if (pingResult.isUp) {
          // API RECUPERADA ✅
          this.logger.log(`[Cron] ✅ ${apiName} RECOVERED - marking as UP`);

          // 1. Marcar como UP en BD
          await this.apiHealthRepository.markAsUp(
            apiName,
            pingResult.responseTimeMs,
          );

          // 2. Notificar clientes afectados
          await this.healthService.notifyAffectedClients(apiName);

          // 3. Emitir evento WebSocket api:up
          this.websocketGateway.emitApiUp(apiName);

          this.logger.log(
            `[Cron] ${apiName} recovery complete - monitoring deactivated`,
          );
        } else {
          // API sigue DOWN ❌
          this.logger.warn(
            `[Cron] ❌ ${apiName} still DOWN - ${pingResult.error} (${pingResult.responseTimeMs}ms)`,
          );
          // No hacer nada - sigue monitoreando en el próximo ciclo
        }
      }

    } catch (error) {
      this.logger.error(
        `[Cron] Health check failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Activa el monitoreo para una API específica
   * @param apiName - Nombre de la API a monitorear
   */
  async activateMonitoring(apiName: string) {
    this.logger.log(`[HealthMonitor] Activating monitoring for ${apiName}`);
    // El monitoreo ya se activa automáticamente en markAsDown desde Task 7
    // Este método podría usarse para forzar activación manual si fuera necesario
  }

  /**
   * Desactiva el monitoreo para una API específica
   * @param apiName - Nombre de la API
   */
  async deactivateMonitoring(apiName: string) {
    this.logger.log(`[HealthMonitor] Deactivating monitoring for ${apiName}`);
    // El monitoreo ya se desactiva automáticamente en markAsUp
    // Este método podría usarse para forzar desactivación manual si fuera necesario
  }
}
