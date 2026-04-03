import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards, HttpCode, BadRequestException } from '@nestjs/common';
import { IsInt, Min, IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '@common/prisma/prisma.service';
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
    private readonly flowVersionRepo: FlowVersionRepository,
    private readonly prisma: PrismaService,
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
    return this.batchAnalysisService.generateDiagrams(user.tenantId);
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
    return this.batchAnalysisService.regenerateDiagram(flowId);
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
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { clientId } } },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        groupJid: true,
        isActive: true,
        lastMessageAt: true,
      },
    });

    const conversationIds = conversations.map((c) => c.id);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: 'desc' },
      take: msgLimit,
      select: {
        id: true,
        conversationId: true,
        content: true,
        transcription: true,
        direction: true,
        type: true,
        createdAt: true,
      },
    });

    const analysis = await this.prisma.conversationAnalysis.findMany({
      where: { conversationId: { in: conversationIds } },
      select: {
        conversationId: true,
        isInternal: true,
        internalPurpose: true,
        intent: true,
      },
    });

    const analysisMap = new Map(analysis.map((a) => [a.conversationId, a]));

    return conversations.map((c) => ({
      ...c,
      analysis: analysisMap.get(c.id) ?? null,
      messages: messages
        .filter((m) => m.conversationId === c.id)
        .reverse(),
    }));
  }

  @Post('clients/:clientId/mark-internal')
  @HttpCode(200)
  async markClientAsInternal(
    @Param('clientId') clientId: string,
    @Body() dto: MarkInternalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.internalChannelReviewRepo.upsert({
      tenantId: user.tenantId,
      clientId,
      groupJid: null,
      internalPurpose: dto.internalPurpose,
      channelName: dto.channelName,
    });

    await this.internalChannelReviewRepo.review(
      (await this.prisma.internalChannelReview.findFirst({
        where: { tenantId: user.tenantId, clientId },
        select: { id: true },
      }))!.id,
      { status: 'approved' },
    );

    await this.clientLabelRepo.upsertDraftLabel({
      tenantId: user.tenantId,
      clientId,
      groupJid: null,
      internalPurpose: dto.internalPurpose,
      channelName: dto.channelName,
    });

    await this.conversationAnalysisRepo.markAllAsInternalByClient(clientId, dto.internalPurpose);

    return { clientId, channelName: dto.channelName, status: 'approved' };
  }

  @Post('groups/:groupJid/mark-internal')
  @HttpCode(200)
  async markGroupAsInternal(
    @Param('groupJid') groupJid: string,
    @Body() dto: MarkInternalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.internalChannelReviewRepo.upsert({
      tenantId: user.tenantId,
      clientId: null,
      groupJid,
      internalPurpose: dto.internalPurpose,
      channelName: dto.channelName,
    });

    await this.internalChannelReviewRepo.review(
      (await this.prisma.internalChannelReview.findFirst({
        where: { tenantId: user.tenantId, groupJid },
        select: { id: true },
      }))!.id,
      { status: 'approved' },
    );

    await this.clientLabelRepo.upsertDraftLabel({
      tenantId: user.tenantId,
      clientId: null,
      groupJid,
      internalPurpose: dto.internalPurpose,
      channelName: dto.channelName,
    });

    await this.conversationAnalysisRepo.markAllAsInternalByGroup(groupJid, dto.internalPurpose);

    return { groupJid, channelName: dto.channelName, status: 'approved' };
  }
}
