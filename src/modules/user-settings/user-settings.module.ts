import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsRepository } from './repositories/user-settings.repository';

@Module({
  imports: [PrismaModule],
  controllers: [UserSettingsController],
  providers: [UserSettingsRepository],
  exports: [UserSettingsRepository],
})
export class UserSettingsModule {}
