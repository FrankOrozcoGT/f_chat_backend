import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRole } from '@prisma/client';
import { DashboardRepository } from './repositories/dashboard.repository';
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

  constructor(
    private readonly dashboardRepository: DashboardRepository,
    private readonly dashboardService: DashboardService,
  ) {}

  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardResponseDto> {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(new Date().setDate(to.getDate() - 30));

    // Asegurar que "to" incluya el fin del día
    to.setHours(23, 59, 59, 999);

    this.logger.log(
      `GET /api/dashboard - tenantId: ${user.tenantId}, from: ${from.toISOString()}, to: ${to.toISOString()}`,
    );

    const rawStats = await this.dashboardRepository.getMessageStats(
      user.tenantId,
      from,
      to,
    );

    const metrics = this.dashboardService.calculateMetrics(rawStats);

    return new DashboardResponseDto({
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
      ...metrics,
    });
  }
}
