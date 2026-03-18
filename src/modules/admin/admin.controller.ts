import {
  Controller,
  Get,
  Query,
  UseGuards,
  Patch,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { SystemAdminGuard } from '@common/guards/system-admin.guard';
import { AdminService } from './admin.service';
import { CostsRepository } from './repositories/costs.repository';
import { ApiHealthRepository } from '@modules/health/repositories/api-health.repository';
import { TenantSettingsRepository } from '@modules/tenant-settings/repositories/tenant-settings.repository';
import { TenantRepository } from '@modules/tenants/repositories/tenant.repository';
import { CostsQueryDto } from './dto/costs-query.dto';
import { CostsResponseDto } from './dto/costs-response.dto';
import { UpdateUserLimitsDto } from './dto/update-user-limits.dto';
import { UpdateUserPlanDto } from './dto/update-user-plan.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly costsRepository: CostsRepository,
    private readonly apiHealthRepository: ApiHealthRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly tenantRepository: TenantRepository,
  ) {}

  @Get('costs')
  async getCosts(@Query() query: CostsQueryDto): Promise<CostsResponseDto> {
    const apiCalls = await this.costsRepository.getApiCallsByPeriod(query.period);
    return this.adminService.aggregateCosts(apiCalls);
  }

  @Get('tenants')
  async getAllTenants() {
    return this.tenantRepository.findAllWithSettings();
  }

  @Get('health')
  async getHealthStatus() {
    const dbRecords = await this.apiHealthRepository.getAllApiHealth();
    return this.adminService.getHealthStatus(dbRecords);
  }

  @Patch('tenants/:tenantId/plan')
  async updateTenantPlan(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateUserPlanDto,
  ) {
    const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    if (!settings) {
      throw new NotFoundException('Tenant settings not found');
    }
    return this.tenantSettingsRepository.updatePlan(tenantId, dto.plan);
  }

  @Patch('tenants/:tenantId/limits')
  async updateTenantLimits(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateUserLimitsDto,
  ) {
    const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    if (!settings) {
      throw new NotFoundException('Tenant settings not found');
    }
    return this.tenantSettingsRepository.updateLimits(tenantId, dto);
  }
}
