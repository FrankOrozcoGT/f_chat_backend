import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { NodeRepository } from './repositories/node.repository';
import { NodeSessionRepository } from '@common/conversation-session/node-session.repository';
import { IntentRepository } from './repositories/intent.repository';
import { FlowVersionRepository, FlowSnapshot } from './repositories/flow-version.repository';
import { NodeFunctionRegistry } from './functions/node-function.registry';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { CreateTransitionDto } from './dto/create-transition.dto';
import { CreateIntentDto } from './dto/create-intent.dto';
import { UpdateIntentDto } from './dto/update-intent.dto';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { TemplateRepository } from './repositories/template.repository';
import { NodesService } from './nodes.service';
import { Prisma } from '@prisma/client';

interface AuthUser {
  id: string;
  tenantId: string;
}

@Controller('api/nodes')
@UseGuards(JwtAuthGuard)
export class NodesController {
  constructor(
    private readonly nodeRepo: NodeRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly intentRepo: IntentRepository,
    private readonly functionRegistry: NodeFunctionRegistry,
    private readonly flowVersionRepo: FlowVersionRepository,
    private readonly templateRepo: TemplateRepository,
    private readonly nodesService: NodesService,
  ) {}

  // ─── Functions ───────────────────────────────────────────────────────────────

  @Get('functions')
  getFunctions() {
    return this.functionRegistry.getAll();
  }

  // ─── Flows ───────────────────────────────────────────────────────────────────

  @Get('flows')
  async getMyFlows(@CurrentUser() user: AuthUser) {
    const flows = await this.nodeRepo.findAllFlowsByTenantId(user.tenantId);

    return Promise.all(flows.map(async (flow) => {
      if (flow.nodes.length > 0) {
        return { ...flow, source: 'active' as const };
      }

      const latestVersion = await this.flowVersionRepo.findLatestByFlowId(flow.id);
      if (!latestVersion?.nodesSnapshot) {
        return { ...flow, source: 'active' as const };
      }

      return {
        ...flow,
        ...this.nodesService.buildDraftFlowView(
          flow.id,
          latestVersion.id,
          latestVersion.version,
          latestVersion.diagramApproved,
          latestVersion.nodesSnapshot,
        ),
      };
    }));
  }

  @Get('flows/active-sessions')
  async getActiveSessions(@CurrentUser() user: AuthUser) {
    const flows = await this.nodeRepo.findAllFlowsByTenantId(user.tenantId);
    const flowIds = flows.map((f) => f.id);
    if (flowIds.length === 0) return {};
    return this.nodeSessionRepo.countActiveByNode(flowIds);
  }

  @Get('flows/:flowId/versions')
  async getFlowVersions(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string) {
    const versions = await this.flowVersionRepo.findByFlowId(flowId, user.tenantId);
    return versions.map((v) => {
      const snapshot = v.nodesSnapshot as { nodes?: unknown[]; transitions?: unknown[] } | null;
      const nodeCount = Array.isArray(snapshot?.nodes) ? snapshot.nodes.length : 0;
      const transitionCount = Array.isArray(snapshot?.transitions) ? snapshot.transitions.length : 0;
      return {
        id: v.id,
        version: v.version,
        nodeCount,
        transitionCount,
        hasDiagram: !!v.consolidatedDiagram,
        diagramApproved: v.diagramApproved,
        diagramModified: v.diagramModified,
        isPromoted: v.isPromoted,
        createdAt: v.createdAt,
      };
    });
  }

  @Get('flows/:flowId/versions/:versionId')
  async getFlowVersion(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string, @Param('versionId') versionId: string) {
    const version = await this.flowVersionRepo.findById(versionId, user.tenantId);
    if (!version || version.flowId !== flowId) {
      throw new NotFoundException(`Version ${versionId} not found for flow ${flowId}`);
    }

    const flow = await this.nodeRepo.findFlowById(flowId);
    if (!flow) throw new NotFoundException(`Flow ${flowId} not found`);

    return {
      ...flow,
      ...this.nodesService.buildDraftFlowView(
        flowId,
        version.id,
        version.version,
        version.diagramApproved,
        version.nodesSnapshot,
      ),
      consolidatedDiagram: version.consolidatedDiagram,
      nodeCategories: version.nodeCategories,
      internalQueues: version.internalQueues,
    };
  }

  @Post('flows')
  createFlow(@CurrentUser() user: AuthUser, @Body() dto: CreateFlowDto) {
    return this.nodeRepo.createFlow({ tenantId: user.tenantId, ...dto });
  }

  @Put('flows/:id')
  async updateFlow(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFlowDto) {
    const result = await this.nodeRepo.updateFlow(id, user.tenantId, dto);
    if (!result) throw new NotFoundException('Flow not found');
    return result;
  }

  @Delete('flows/:id')
  async deleteFlow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.nodeRepo.deleteFlow(id, user.tenantId);
    if (!result) throw new NotFoundException('Flow not found');
    return result;
  }

  // ─── Flow Versions ───────────────────────────────────────────────────────────

  @Post('flows/:flowId/promote')
  async promoteFlow(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string) {
    // Toma el último snapshot del historial y lo aplica al flow
    const versions = await this.flowVersionRepo.findByFlowId(flowId, user.tenantId);
    if (versions.length === 0) throw new BadRequestException('No versions in history to promote');

    const latest = versions[0]; // findByFlowId retorna desc por version
    await this.nodesService.applySnapshot(flowId, latest.nodesSnapshot as unknown as FlowSnapshot);
    await this.flowVersionRepo.markAsPromoted(latest.id);
    return { promoted: true, flowId, versionId: latest.id };
  }

  @Post('flows/:flowId/restore/:versionId')
  async restoreFlowVersion(
    @CurrentUser() user: AuthUser,
    @Param('flowId') flowId: string,
    @Param('versionId') versionId: string,
  ) {
    const version = await this.flowVersionRepo.findById(versionId, user.tenantId);
    if (!version) throw new NotFoundException('Version not found');
    if (version.flowId !== flowId) throw new BadRequestException('Version does not belong to this flow');

    await this.nodesService.applySnapshot(flowId, version.nodesSnapshot as unknown as FlowSnapshot);
    return { restored: true, flowId, versionId };
  }

  // ─── Transitions ─────────────────────────────────────────────────────────────

  @Get('flows/:flowId/transitions')
  getTransitions(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string) {
    return this.nodeRepo.findTransitionsByFlowId(flowId, user.tenantId);
  }

  @Post('flows/:flowId/transitions')
  async createTransition(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string, @Body() dto: CreateTransitionDto) {
    const flow = await this.nodeRepo.findFlowById(flowId);
    if (!flow || flow.tenantId !== user.tenantId) throw new NotFoundException('Flow not found');
    return this.nodeRepo.createTransition({ flowId, ...dto });
  }

  @Delete('flows/:flowId/transitions/:id')
  async deleteTransition(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.nodeRepo.deleteTransition(id, user.tenantId);
    if (result.count === 0) throw new NotFoundException('Transition not found');
    return result;
  }

  // ─── Intents ─────────────────────────────────────────────────────────────────

  @Get('intents')
  getIntents(@CurrentUser() user: AuthUser) {
    return this.intentRepo.findByTenantId(user.tenantId);
  }

  @Post('intents')
  createIntent(@CurrentUser() user: AuthUser, @Body() dto: CreateIntentDto) {
    return this.intentRepo.create(user.tenantId, dto);
  }

  @Put('intents/:id')
  async updateIntent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateIntentDto) {
    const result = await this.intentRepo.updateById(id, user.tenantId, dto);
    if (!result) throw new NotFoundException('Intent not found');
    return result;
  }

  @Delete('intents/:id')
  async deleteIntent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.intentRepo.deleteById(id, user.tenantId);
    if (result.count === 0) throw new NotFoundException('Intent not found');
    return result;
  }

  @Get(':id')
  async getNode(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const node = await this.nodeRepo.findById(id, user.tenantId);
    if (!node) throw new NotFoundException('Node not found');
    return node;
  }

  @Post()
  async createNode(@CurrentUser() user: AuthUser, @Body() body: CreateNodeDto) {
    return this.nodeRepo.createNode({
      ...body,
      tools: body.tools as Prisma.InputJsonValue,
      preCodeInputSchema: body.preCodeInputSchema as Prisma.InputJsonValue,
      postCodeInputSchema: body.postCodeInputSchema as Prisma.InputJsonValue,
      todos: body.todos as Prisma.InputJsonValue,
      tenant: { connect: { id: user.tenantId } },
    });
  }

  @Put(':id')
  async updateNode(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateNodeDto,
  ) {
    const data: Prisma.NodeUpdateInput = {
      ...body,
      tools: body.tools as Prisma.InputJsonValue,
      preCodeInputSchema: body.preCodeInputSchema as Prisma.InputJsonValue,
      postCodeInputSchema: body.postCodeInputSchema as Prisma.InputJsonValue,
      todos: body.todos as Prisma.InputJsonValue,
    };
    const result = await this.nodeRepo.updateNode(id, user.tenantId, data);
    if (!result) throw new NotFoundException('Node not found');
    return result;
  }

  @Post('flow/:flowId/nodes/:nodeId')
  async addNodeToFlow(
    @CurrentUser() user: AuthUser,
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
  ) {
    const flow = await this.nodeRepo.findFlowById(flowId);
    if (!flow || flow.tenantId !== user.tenantId) throw new NotFoundException('Flow not found');
    return this.nodeRepo.addNodeToFlow(flowId, nodeId);
  }

  // ─── Templates ───────────────────────────────────────────────────────────────

  @Get('templates/:code')
  async getTemplate(@Param('code') code: string, @CurrentUser() user: AuthUser) {
    const content = await this.templateRepo.findByCode(code, user.tenantId);
    return { code, content };
  }

  @Put('templates/:code')
  async upsertTemplate(
    @Param('code') code: string,
    @Body() body: { content: string },
    @CurrentUser() user: AuthUser,
  ) {
    await this.templateRepo.upsert(code, user.tenantId, body.content);
    return { code, content: body.content };
  }
}
