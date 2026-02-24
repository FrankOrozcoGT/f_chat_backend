import { Module } from '@nestjs/common';
import { LimitsService } from './limits.service';
import { UsersModule } from '@modules/users/users.module';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [UsersModule, PrismaModule],
  providers: [LimitsService, PhoneRepository],
  exports: [LimitsService],
})
export class LimitsModule {}
