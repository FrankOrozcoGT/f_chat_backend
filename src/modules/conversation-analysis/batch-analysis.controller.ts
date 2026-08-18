import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards, HttpCode, BadRequestException, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRole } from '@prisma/client';
import { BatchAnalysisService } from './batch-analysis.service';
import { FlowGenerationService } from './flow-generation.service';
import { InternalChannelService } from './internal-channel.service';
import { FlowIntentRepository } from './repositories/flow-intent.repository';
import { InternalChannelReviewRepository } from './repositories/internal-channel-review.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { FlowVersionRepository } from '@modules/nodes/repositories/flow-version.repository';
import { RunBatchDto } from './dto/run-batch.dto';
import { UpdateDiagramDto } from './dto/update-diagram.dto';
import { MarkInternalDto } from './dto/mark-internal.dto';
import { MergeIntentsDto } from './dto/merge-intents.dto';
import { MergeAnalysesDto } from './dto/merge-analyses.dto';
import { ReviewInternalDto } from './dto/review-internal.dto';

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
    private readonly internalChannelService: InternalChannelService,
    private readonly flowIntentRepo: FlowIntentRepository,
    private readonly internalChannelReviewRepo: InternalChannelReviewRepository,
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
    return this.internalChannelService.reviewInternal(id, user.tenantId, dto);
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
    return this.internalChannelService.markClientAsInternal(clientId, user.tenantId, dto);
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
    return this.internalChannelService.markGroupAsInternal(groupJid, user.tenantId, dto);
  }
}
