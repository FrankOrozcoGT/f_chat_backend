import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRole } from '@prisma/client';
import { BatchAnalysisService } from './batch-analysis.service';
import { FlowGenerationService } from './flow-generation.service';
import { InternalChannelService } from './internal-channel.service';
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
  constructor(
    private readonly batchAnalysisService: BatchAnalysisService,
    private readonly flowGenerationService: FlowGenerationService,
    private readonly internalChannelService: InternalChannelService,
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
    return this.flowGenerationService.getFlowDiagram(flowId);
  }

  @Patch('flows/:flowId/diagram')
  async updateFlowDiagram(
    @Param('flowId') flowId: string,
    @Body() dto: UpdateDiagramDto,
  ) {
    return this.flowGenerationService.updateFlowDiagram(flowId, dto);
  }

  @Post('flows/:flowId/regenerate-diagram')
  @HttpCode(200)
  async regenerateDiagram(@Param('flowId') flowId: string) {
    return this.flowGenerationService.regenerateDiagram(flowId);
  }

  @Post('flows/:flowId/approve-diagram')
  @HttpCode(200)
  async approveDiagram(@Param('flowId') flowId: string) {
    return this.flowGenerationService.approveDiagram(flowId);
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
    return this.internalChannelService.getInternalReviews(user.tenantId);
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
    return this.batchAnalysisService.getFlowAnalyses(flowId);
  }

  @Get('clients/:clientId/conversations')
  async getClientConversations(
    @Param('clientId') clientId: string,
    @Query('limit') limit?: string,
  ) {
    return this.batchAnalysisService.getClientConversations(clientId, limit);
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
    return this.batchAnalysisService.getIntents(user.tenantId);
  }

  @Post('intents/merge-analyses')
  @HttpCode(200)
  async mergeAnalyses(
    @Body() dto: MergeAnalysesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.batchAnalysisService.mergeAnalyses(dto, user.tenantId);
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
