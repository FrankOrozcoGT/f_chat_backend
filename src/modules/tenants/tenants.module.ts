import { Module, forwardRef } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantRepository } from './repositories/tenant.repository';
import { InvitationRepository } from './repositories/invitation.repository';
import { AuthModule } from '@modules/auth/auth.module';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { EmailService } from '@common/services/email.service';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [forwardRef(() => AuthModule), PrismaModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantRepository, InvitationRepository, TenantRolesGuard, UserRepository, EmailService],
  exports: [TenantRepository],
})
export class TenantsModule {}
