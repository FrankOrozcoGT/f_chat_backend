import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { HealthModule } from '@modules/health/health.module';
import { UsersModule } from '@modules/users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CostsRepository } from './repositories/costs.repository';

@Module({
  imports: [PrismaModule, HealthModule, UsersModule],
  controllers: [AdminController],
  providers: [AdminService, CostsRepository],
  exports: [AdminService],
})
export class AdminModule {}
