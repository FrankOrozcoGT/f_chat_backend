import { Controller, Post, Get, Patch, Param, Body, UseGuards, HttpCode, BadRequestException } from '@nestjs/common';
import { IsInt, Min, IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRole } from '@prisma/client';
import { BatchAnalysisService } from './batch-analysis.service';
import { FlowIntentRepository } from './repositories/flow-intent.repository';
import { InternalChannelReviewRepository } from './repositories/internal-channel-review.repository';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';

class RunBatchDto {
  @IsInt()
  @Min(1)
  channelCount: number;

  @IsInt()
  @Min(1)
  messageLimit: number;
}

class ReviewInternalDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  modifiedPurpose?: string | null;
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
    private readonly internalChannelReviewRepo: InternalChannelReviewRepository,
    private readonly clientLabelRepo: ClientLabelRepository,
    private readonly conversationAnalysisRepo: ConversationAnalysisRepository,
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

  @Get('internals')
  async getInternalReviews(@CurrentUser() user: AuthenticatedUser) {
    return this.internalChannelReviewRepo.findByTenantId(user.tenantId);
  }

  @Patch('internals/:id')
  async reviewInternal(
    @Param('id') id: string,
    @Body() dto: ReviewInternalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.internalChannelReviewRepo.review(id, {
      status: dto.status,
      modifiedPurpose: dto.modifiedPurpose,
    });

    if (dto.status === 'approved') {
      if (!updated.channelName) {
        throw new BadRequestException(`Cannot approve internal channel ${id}: channelName is missing`);
      }
      const purpose = dto.modifiedPurpose ?? updated.internalPurpose;
      if (!purpose) {
        throw new BadRequestException(`Cannot approve internal channel ${id}: internalPurpose is missing`);
      }
      await this.clientLabelRepo.upsertDraftLabel({
        tenantId: user.tenantId,
        clientId: updated.clientId ?? null,
        groupJid: updated.groupJid ?? null,
        internalPurpose: purpose,
        channelName: updated.channelName,
      });
      if (updated.clientId) {
        await this.conversationAnalysisRepo.markAllAsInternalByClient(updated.clientId, purpose);
      }
      if (updated.groupJid) {
        await this.conversationAnalysisRepo.markAllAsInternalByGroup(updated.groupJid, purpose);
      }
    }

    return updated;
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
