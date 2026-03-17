// @deprecated — Replaced by TenantSettingsModule. Kept as stub.
import { Module } from '@nestjs/common';
import { UserSettingsRepository } from './repositories/user-settings.repository';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [UserSettingsRepository],
  exports: [UserSettingsRepository],
})
export class UserSettingsModule {}
