import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards, HttpCode, BadRequestException, Logger } from '@nestjs/common';
import { IsInt, Min, IsIn, IsOptional, IsString, IsArray, ArrayMinSize } from 'class-validator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRole } from '@prisma/client';
import { BatchAnalysisService } from './batch-analysis.service';
import { FlowGenerationService } from './flow-generation.service';
import { FlowIntentRepository } from './repositories/flow-intent.repository';
import { InternalChannelReviewRepository } from './repositories/internal-channel-review.repository';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { FlowVersionRepository } from '@modules/nodes/repositories/flow-version.repository';

class RunBatchDto {
  @IsInt()
  @Min(1)
  channelCount: number;

  @IsInt()
  @Min(1)
  messageLimit: number;
}

class UpdateDiagramDto {
  @IsString()
  diagram: string;
}

class MarkInternalDto {
  @IsString()
  channelName: string;

  @IsString()
  internalPurpose: string;
}

class MergeIntentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sourceIntentIds: string[];
}

class MergeAnalysesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sourceIntents: string[];

  @IsString()
  targetIntent: string;
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
  private readonly logger = new Logger(BatchAnalysisController.name);

  constructor(
    private readonly batchAnalysisService: BatchAnalysisService,
    private readonly flowGenerationService: FlowGenerationService,
    private readonly flowIntentRepo: FlowIntentRepository,
    private readonly internalChannelReviewRepo: InternalChannelReviewRepository,
    private readonly clientLabelRepo: ClientLabelRepository,
    private readonly conversationAnalysisRepo: ConversationAnalysisRepository,
    private readonly flowVersionRepo: FlowVersionRepository,
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

  @Post('generate-diagrams')
  @HttpCode(200)
  async generateDiagrams(@CurrentUser() user: AuthenticatedUser) {
    return this.flowGenerationService.generateDiagrams(user.tenantId);
  }

  @Get('flows/:flowId/diagram')
  async getFlowDiagram(@Param('flowId') flowId: string) {
    const version = await this.flowVersionRepo.findLatestWithDiagram(flowId);
    if (!version) throw new BadRequestException(`No version found for flow ${flowId}`);
    return {
      flowId,
      versionId: version.id,
      version: version.version,
      consolidatedDiagram: version.consolidatedDiagram,
      nodeMapping: version.nodeMapping,
      nodeCategories: version.nodeCategories,
      internalQueues: version.internalQueues,
      representativeCases: version.representativeCases,
      diagramApproved: version.diagramApproved,
      diagramModified: version.diagramModified,
    };
  }

  @Patch('flows/:flowId/diagram')
  async updateFlowDiagram(
    @Param('flowId') flowId: string,
    @Body() dto: UpdateDiagramDto,
  ) {
    const version = await this.flowVersionRepo.findLatestWithDiagram(flowId);
    if (!version) throw new BadRequestException(`No version found for flow ${flowId}`);
    await this.flowVersionRepo.updateDiagram(version.id, dto.diagram);
    return { flowId, versionId: version.id, diagramModified: true };
  }

  @Post('flows/:flowId/regenerate-diagram')
  @HttpCode(200)
  async regenerateDiagram(@Param('flowId') flowId: string) {
    return this.flowGenerationService.regenerateDiagram(flowId);
  }

  @Post('flows/:flowId/approve-diagram')
  @HttpCode(200)
  async approveDiagram(@Param('flowId') flowId: string) {
    await this.flowVersionRepo.approveDiagram(flowId);
    return { flowId, diagramApproved: true };
  }

  @Post('generate-flows')
  @HttpCode(200)
  async generateFlows(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ flowsGenerated: number; flows: { id: string; name: string }[] }> {
    return this.flowGenerationService.generateDraftFlows(user.tenantId);
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
      const purpose = dto.modifiedPurpose ?? updated.internalPurpose;
      await this.applyApprovedInternalChannel(id, user.tenantId, {
        clientId: updated.clientId,
        groupJid: updated.groupJid,
        channelName: updated.channelName,
        internalPurpose: purpose,
      });
    }

    return updated;
  }

  /**
   * Propaga la aprobación de un canal interno: etiqueta al cliente/grupo y
   * marca sus análisis históricos como internos. Requiere que el
   * InternalChannelReview con `id` ya esté en status 'approved'.
   */
  private async applyApprovedInternalChannel(
    reviewId: string,
    tenantId: string,
    data: {
      clientId: string | null;
      groupJid: string | null;
      channelName: string | null;
      internalPurpose: string | null;
    },
  ) {
    if (!data.channelName) {
      throw new BadRequestException(`Cannot approve internal channel ${reviewId}: channelName is missing`);
    }
    if (!data.internalPurpose) {
      throw new BadRequestException(`Cannot approve internal channel ${reviewId}: internalPurpose is missing`);
    }

    await this.clientLabelRepo.upsertDraftLabel({
      tenantId,
      clientId: data.clientId ?? null,
      groupJid: data.groupJid ?? null,
      internalPurpose: data.internalPurpose,
      channelName: data.channelName,
    });

    if (data.clientId) {
      await this.conversationAnalysisRepo.markAllAsInternalByClient(data.clientId, data.internalPurpose);
    }
    if (data.groupJid) {
      await this.conversationAnalysisRepo.markAllAsInternalByGroup(data.groupJid, data.internalPurpose);
    }
  }

  @Get('flows/:flowId/analyses')
  async getFlowAnalyses(@Param('flowId') flowId: string) {
    const records = await this.flowIntentRepo.findByFlowId(flowId);
    return records.map((r) => ({
      analysisId: r.analysis.id,
      conversationId: r.analysis.conversationId,
      groupJid: r.analysis.conversation?.groupJid ?? null,
      participants: (r.analysis.conversation?.participants ?? []).map((p) => ({
        clientId: p.clientId,
        name: p.client?.name ?? null,
        phoneNumber: p.client?.phoneNumber ?? null,
      })),
      intent: r.analysis.intent,
      flowSummary: r.analysis.flowSummary,
      flowDiagram: r.analysis.flowDiagram,
      isInternal: r.analysis.isInternal,
      internalPurpose: r.analysis.internalPurpose,
      analyzedAt: r.analysis.analyzedAt,
    }));
  }

  @Get('clients/:clientId/conversations')
  async getClientConversations(
    @Param('clientId') clientId: string,
    @Query('limit') limit?: string,
  ) {
    const msgLimit = parseInt(limit ?? '100', 10);
    return this.conversationAnalysisRepo.findClientConversationsWithMessages(clientId, msgLimit);
  }

  @Post('clients/:clientId/mark-internal')
  @HttpCode(200)
  async markClientAsInternal(
    @Param('clientId') clientId: string,
    @Body() dto: MarkInternalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const review = await this.internalChannelReviewRepo.upsert({
      tenantId: user.tenantId,
      clientId,
      groupJid: null,
      internalPurpose: dto.internalPurpose,
      channelName: dto.channelName,
    });
    await this.internalChannelReviewRepo.review(review.id, { status: 'approved' });

    await this.applyApprovedInternalChannel(review.id, user.tenantId, {
      clientId,
      groupJid: null,
      channelName: dto.channelName,
      internalPurpose: dto.internalPurpose,
    });

    return { clientId, channelName: dto.channelName, status: 'approved' };
  }

  @Get('intents')
  async getIntents(@CurrentUser() user: AuthenticatedUser) {
    const analyses = await this.conversationAnalysisRepo.findAllByTenantId(user.tenantId, false);
    const grouped = new Map<string, number>();
    for (const a of analyses) {
      if (!a.intent) continue;
      grouped.set(a.intent, (grouped.get(a.intent) ?? 0) + 1);
    }
    return Array.from(grouped.entries())
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count);
  }

  @Post('intents/merge-analyses')
  @HttpCode(200)
  async mergeAnalyses(
    @Body() dto: MergeAnalysesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    let totalRenamed = 0;
    for (const source of dto.sourceIntents) {
      const result = await this.conversationAnalysisRepo.renameIntent(source, dto.targetIntent, user.tenantId);
      totalRenamed += result.count;
      this.logger.log(`mergeAnalyses: renamed ${result.count} analyses from "${source}" to "${dto.targetIntent}"`);
    }
    return { targetIntent: dto.targetIntent, totalRenamed };
  }

  @Post('intents/:targetIntentId/merge')
  @HttpCode(200)
  async mergeIntents(
    @Param('targetIntentId') targetIntentId: string,
    @Body() dto: MergeIntentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flowGenerationService.mergeIntents(user.tenantId, dto.sourceIntentIds, targetIntentId);
  }

  @Post('groups/:groupJid/mark-internal')
  @HttpCode(200)
  async markGroupAsInternal(
    @Param('groupJid') groupJid: string,
    @Body() dto: MarkInternalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const review = await this.internalChannelReviewRepo.upsert({
      tenantId: user.tenantId,
      clientId: null,
      groupJid,
      internalPurpose: dto.internalPurpose,
      channelName: dto.channelName,
    });
    await this.internalChannelReviewRepo.review(review.id, { status: 'approved' });

    await this.applyApprovedInternalChannel(review.id, user.tenantId, {
      clientId: null,
      groupJid,
      channelName: dto.channelName,
      internalPurpose: dto.internalPurpose,
    });

    return { groupJid, channelName: dto.channelName, status: 'approved' };
  }
}
