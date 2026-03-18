import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { HealthModule } from '@modules/health/health.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CostsRepository } from './repositories/costs.repository';
import { TenantSettingsRepository } from '@modules/tenant-settings/repositories/tenant-settings.repository';
import { TenantRepository } from '@modules/tenants/repositories/tenant.repository';

@Module({
  imports: [PrismaModule, HealthModule],
  controllers: [AdminController],
  providers: [AdminService, CostsRepository, TenantSettingsRepository, TenantRepository],
  exports: [AdminService],
})
export class AdminModule {}
