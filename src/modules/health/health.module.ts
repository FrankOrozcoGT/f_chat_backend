import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@common/prisma/prisma.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { ExternalIntegrationsModule } from '@common/external-integrations/external-integrations.module';
import { HealthController } from '@modules/health/health.controller';
import { InternalHealthController } from './internal-health.controller';
import { ApiHealthRepository } from './repositories/api-health.repository';
import { HealthService } from './health.service';
import { InternalHealthService } from './internal-health.service';
import { HealthMonitorService } from './health-monitor.service';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), WebSocketModule, ExternalIntegrationsModule],
  controllers: [HealthController, InternalHealthController],
  providers: [ApiHealthRepository, HealthService, InternalHealthService, HealthMonitorService],
  exports: [ApiHealthRepository, HealthService],
})
export class HealthModule {}
