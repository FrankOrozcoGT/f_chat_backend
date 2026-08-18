import { Module } from '@nestjs/common';
import { TenantSettingsController } from './tenant-settings.controller';
import { InternalTenantSettingsController } from './internal-tenant-settings.controller';
import { TenantSettingsRepository } from './repositories/tenant-settings.repository';
import { TenantSettingsService } from './tenant-settings.service';
import { AuthModule } from '@modules/auth/auth.module';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';

@Module({
  imports: [AuthModule],
  controllers: [TenantSettingsController, InternalTenantSettingsController],
  providers: [TenantSettingsService, TenantSettingsRepository, TenantRolesGuard],
  exports: [TenantSettingsRepository],
})
export class TenantSettingsModule {}
