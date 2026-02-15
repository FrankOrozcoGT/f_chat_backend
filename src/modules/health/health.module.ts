import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { HealthController } from '@modules/health/health.controller';
import { ApiHealthRepository } from './repositories/api-health.repository';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [ApiHealthRepository],
  exports: [ApiHealthRepository],
})
export class HealthModule {}
