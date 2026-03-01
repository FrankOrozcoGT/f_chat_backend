import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { UserSettingsController } from './user-settings.controller';
import { InternalUserSettingsController } from './internal-user-settings.controller';
import { UserSettingsRepository } from './repositories/user-settings.repository';

@Module({
  imports: [PrismaModule],
  controllers: [UserSettingsController, InternalUserSettingsController],
  providers: [UserSettingsRepository],
  exports: [UserSettingsRepository],
})
export class UserSettingsModule {}
