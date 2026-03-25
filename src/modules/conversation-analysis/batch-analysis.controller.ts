import { Controller, Post, Get, Param, Body, UseGuards, HttpCode } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRole } from '@prisma/client';
import { BatchAnalysisService } from './batch-analysis.service';
import { FlowIntentRepository } from './repositories/flow-intent.repository';

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
  constructor(
    private readonly batchAnalysisService: BatchAnalysisService,
    private readonly flowIntentRepo: FlowIntentRepository,
  ) {}

  @Post()
  @HttpCode(200)
  async runBatch(
    @Body() dto: RunBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ analyzed: number; internalsDetected: number; totalCostUsd: number; intents: { intent: string; count: number }[] }> {
    return this.batchAnalysisService.runBatch(
      user.tenantId,
      dto.channelCount,
      dto.messageLimit,
    );
  }

  @Post('generate-flows')
  @HttpCode(200)
  async generateFlows(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ flowsGenerated: number; flows: any[] }> {
    return this.batchAnalysisService.generateDraftFlows(user.tenantId);
  }

  @Get('flows/:flowId/analyses')
  async getFlowAnalyses(@Param('flowId') flowId: string) {
    const records = await this.flowIntentRepo.findByFlowId(flowId);
    return records.map((r) => ({
      analysisId: r.analysis.id,
      conversationId: r.analysis.conversationId,
      intent: r.analysis.intent,
      flowSummary: r.analysis.flowSummary,
      flowDiagram: r.analysis.flowDiagram,
      isInternal: r.analysis.isInternal,
      internalPurpose: r.analysis.internalPurpose,
      analyzedAt: r.analysis.analyzedAt,
    }));
  }
}
