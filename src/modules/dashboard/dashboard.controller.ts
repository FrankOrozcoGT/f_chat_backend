import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

interface AuthenticatedUser {
  id: string;
  tenantId: string;
  tenantRole: TenantRole;
}

@Controller('api/dashboard')
@UseGuards(JwtAuthGuard, TenantRolesGuard)
@TenantRoles(TenantRole.owner, TenantRole.tecnico)
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardResponseDto> {
    this.logger.log(`GET /api/dashboard - tenantId: ${user.tenantId}`);
    return this.dashboardService.getDashboard(user.tenantId, query.from, query.to);
  }
}
