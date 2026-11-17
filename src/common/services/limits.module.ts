import { Module } from '@nestjs/common';
import { LimitsService } from './limits.service';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { PrismaModule } from '@common/prisma/prisma.module';
import { TenantSettingsRepository } from '@modules/tenant-settings/repositories/tenant-settings.repository';
import { ExternalIntegrationsModule } from '@common/external-integrations/external-integrations.module';

@Module({
  imports: [PrismaModule, ExternalIntegrationsModule],
  providers: [LimitsService, PhoneRepository, TenantSettingsRepository],
  exports: [LimitsService],
})
export class LimitsModule {}
