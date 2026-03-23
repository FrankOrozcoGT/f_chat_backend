import { Controller, Post, Body, UseGuards, HttpCode } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRole } from '@prisma/client';
import { BatchAnalysisService } from './batch-analysis.service';

class RunBatchDto {
  @IsInt()
  @Min(1)
  channelCount: number;

  @IsInt()
  @Min(1)
  messageLimit: number;
}

interface AuthenticatedUser {
  id: string;
  tenantId: string;
  tenantRole: TenantRole;
}

@Controller('api/batch-analysis')
@UseGuards(JwtAuthGuard, TenantRolesGuard)
@TenantRoles(TenantRole.owner, TenantRole.tecnico)
export class BatchAnalysisController {
  constructor(private readonly batchAnalysisService: BatchAnalysisService) {}

  @Post()
  @HttpCode(200)
  async runBatch(
    @Body() dto: RunBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ analyzed: number; internalsDetected: number; totalCostUsd: number }> {
    return this.batchAnalysisService.runBatch(
      user.tenantId,
      dto.channelCount,
      dto.messageLimit,
    );
  }
}
