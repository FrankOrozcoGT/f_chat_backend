import {
  Controller,
  Get,
  Query,
  UseGuards,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { SystemAdminGuard } from '@common/guards/system-admin.guard';
import { AdminService } from './admin.service';
import { CostsQueryDto } from './dto/costs-query.dto';
import { CostsResponseDto } from './dto/costs-response.dto';
import { UpdateUserLimitsDto } from './dto/update-user-limits.dto';
import { UpdateUserPlanDto } from './dto/update-user-plan.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('costs')
  async getCosts(@Query() query: CostsQueryDto): Promise<CostsResponseDto> {
    return this.adminService.getCosts(query);
  }

  @Get('tenants')
  async getAllTenants() {
    return this.adminService.getAllTenants();
  }

  @Get('health')
  async getHealthStatus() {
    return this.adminService.getHealth();
  }

  @Patch('tenants/:tenantId/plan')
  async updateTenantPlan(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateUserPlanDto,
  ) {
    return this.adminService.updateTenantPlan(tenantId, dto);
  }

  @Patch('tenants/:tenantId/limits')
  async updateTenantLimits(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateUserLimitsDto,
  ) {
    return this.adminService.updateTenantLimits(tenantId, dto);
  }
}
