import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantMemoryRepository } from './repositories/tenant-memory.repository';
import { TenantMemoryController } from './tenant-memory.controller';
import { TenantMemoryService } from './tenant-memory.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TenantMemoryController],
  providers: [TenantMemoryService, TenantMemoryRepository, TenantRolesGuard],
  exports: [TenantMemoryRepository],
})
export class TenantMemoryModule {}
