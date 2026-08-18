import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { NodeFunctionRegistry } from './functions/node-function.registry';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { CreateTransitionDto } from './dto/create-transition.dto';
import { CreateIntentDto } from './dto/create-intent.dto';
import { UpdateIntentDto } from './dto/update-intent.dto';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { NodesService } from './nodes.service';

interface AuthUser {
  id: string;
  tenantId: string;
}

@Controller('api/nodes')
@UseGuards(JwtAuthGuard)
export class NodesController {
  constructor(
    private readonly functionRegistry: NodeFunctionRegistry,
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
    return this.nodesService.getMyFlows(user.tenantId);
  }

  @Get('flows/active-sessions')
  async getActiveSessions(@CurrentUser() user: AuthUser) {
    return this.nodesService.getActiveSessions(user.tenantId);
  }

  @Get('flows/:flowId/versions')
  async getFlowVersions(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string) {
    return this.nodesService.getFlowVersions(flowId, user.tenantId);
  }

  @Get('flows/:flowId/versions/:versionId')
  async getFlowVersion(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string, @Param('versionId') versionId: string) {
    return this.nodesService.getFlowVersion(flowId, versionId, user.tenantId);
  }

  @Post('flows')
  createFlow(@CurrentUser() user: AuthUser, @Body() dto: CreateFlowDto) {
    return this.nodesService.createFlow(user.tenantId, dto);
  }

  @Put('flows/:id')
  async updateFlow(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFlowDto) {
    return this.nodesService.updateFlow(id, user.tenantId, dto);
  }

  @Delete('flows/:id')
  async deleteFlow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodesService.deleteFlow(id, user.tenantId);
  }

  // ─── Flow Versions ───────────────────────────────────────────────────────────

  @Post('flows/:flowId/promote')
  async promoteFlow(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string) {
    return this.nodesService.promoteFlow(flowId, user.tenantId);
  }

  @Post('flows/:flowId/restore/:versionId')
  async restoreFlowVersion(
    @CurrentUser() user: AuthUser,
    @Param('flowId') flowId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.nodesService.restoreFlowVersion(flowId, versionId, user.tenantId);
  }

  // ─── Transitions ─────────────────────────────────────────────────────────────

  @Get('flows/:flowId/transitions')
  getTransitions(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string) {
    return this.nodesService.getTransitions(flowId, user.tenantId);
  }

  @Post('flows/:flowId/transitions')
  async createTransition(@CurrentUser() user: AuthUser, @Param('flowId') flowId: string, @Body() dto: CreateTransitionDto) {
    return this.nodesService.createTransition(flowId, user.tenantId, dto);
  }

  @Delete('flows/:flowId/transitions/:id')
  async deleteTransition(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodesService.deleteTransition(id, user.tenantId);
  }

  // ─── Intents ─────────────────────────────────────────────────────────────────

  @Get('intents')
  getIntents(@CurrentUser() user: AuthUser) {
    return this.nodesService.getIntents(user.tenantId);
  }

  @Post('intents')
  createIntent(@CurrentUser() user: AuthUser, @Body() dto: CreateIntentDto) {
    return this.nodesService.createIntent(user.tenantId, dto);
  }

  @Put('intents/:id')
  async updateIntent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateIntentDto) {
    return this.nodesService.updateIntent(id, user.tenantId, dto);
  }

  @Delete('intents/:id')
  async deleteIntent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodesService.deleteIntent(id, user.tenantId);
  }

  @Get(':id')
  async getNode(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodesService.getNode(id, user.tenantId);
  }

  @Post()
  async createNode(@CurrentUser() user: AuthUser, @Body() body: CreateNodeDto) {
    return this.nodesService.createNode(user.tenantId, body);
  }

  @Put(':id')
  async updateNode(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateNodeDto,
  ) {
    return this.nodesService.updateNode(id, user.tenantId, body);
  }

  @Post('flow/:flowId/nodes/:nodeId')
  async addNodeToFlow(
    @CurrentUser() user: AuthUser,
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.nodesService.addNodeToFlow(flowId, nodeId, user.tenantId);
  }

  // ─── Templates ───────────────────────────────────────────────────────────────

  @Get('templates/:code')
  async getTemplate(@Param('code') code: string, @CurrentUser() user: AuthUser) {
    return this.nodesService.getTemplate(code, user.tenantId);
  }

  @Put('templates/:code')
  async upsertTemplate(
    @Param('code') code: string,
    @Body() body: { content: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.nodesService.upsertTemplate(code, user.tenantId, body.content);
  }
}
