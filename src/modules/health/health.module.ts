import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@common/prisma/prisma.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { HealthController } from '@modules/health/health.controller';
import { InternalHealthController } from './internal-health.controller';
import { ApiHealthRepository } from './repositories/api-health.repository';
import { HealthService } from './health.service';
import { HealthMonitorService } from './health-monitor.service';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), WebSocketModule],
  controllers: [HealthController, InternalHealthController],
  providers: [ApiHealthRepository, HealthService, HealthMonitorService],
  exports: [ApiHealthRepository, HealthService],
})
export class HealthModule {}
