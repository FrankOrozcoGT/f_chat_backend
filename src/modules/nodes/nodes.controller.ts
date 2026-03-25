import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { MessageType } from '@prisma/client';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { NodeRepository } from './repositories/node.repository';
import { NodeSessionRepository } from './repositories/node-session.repository';
import { IntentRepository } from './repositories/intent.repository';
import { FlowVersionRepository, FlowSnapshot, DraftFlowSnapshot } from './repositories/flow-version.repository';
import { NodeFunctionRegistry } from './functions/node-function.registry';
import { TestSessionService } from './services/test-session.service';
import { TestQueueResultStore } from './services/test-queue-result.store';
import { AiWorkflow } from '../ai/langgraph/workflow';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { RedisNodeSessionStore } from './stores/redis-node-session.store';
import { RedisService } from '@common/redis/redis.service';
import { TestStartDto } from './dto/test-start.dto';
import { TestSendDto } from './dto/test-send.dto';
import { TestStepBackDto } from './dto/test-step-back.dto';
import { TestStopDto } from './dto/test-stop.dto';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { CreateTransitionDto } from './dto/create-transition.dto';
import { CreateIntentDto } from './dto/create-intent.dto';
import { UpdateIntentDto } from './dto/update-intent.dto';
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
    private readonly testSessionService: TestSessionService,
    private readonly testQueueResultStore: TestQueueResultStore,
    private readonly workflow: AiWorkflow,
    private readonly phoneRepo: PhoneRepository,
    private readonly redisService: RedisService,
    private readonly flowVersionRepo: FlowVersionRepository,
  ) {}

  // ─── Functions ───────────────────────────────────────────────────────────────

  @Get('functions')
  getFunctions() {
    return this.functionRegistry.getAll();
  }

  // ─── Flows ───────────────────────────────────────────────────────────────────

  @Get('flows')
  getMyFlows(@CurrentUser() user: AuthUser) {
    return this.nodeRepo.findAllFlowsByTenantId(user.tenantId);
  }

  @Get('flows/active-sessions')
  async getActiveSessions(@CurrentUser() user: AuthUser) {
    const flows = await this.nodeRepo.findAllFlowsByTenantId(user.tenantId);
    const flowIds = flows.map((f) => f.id);
    if (flowIds.length === 0) return {};
    return this.nodeSessionRepo.countActiveByNode(flowIds);
  }

  @Post('flows')
  createFlow(@CurrentUser() user: AuthUser, @Body() dto: CreateFlowDto) {
    return this.nodeRepo.createFlow({ tenantId: user.tenantId, ...dto });
  }

  @Put('flows/:id')
  updateFlow(@Param('id') id: string, @Body() dto: UpdateFlowDto) {
    return this.nodeRepo.updateFlow(id, dto);
  }

  @Delete('flows/:id')
  deleteFlow(@Param('id') id: string) {
    return this.nodeRepo.deleteFlow(id);
  }

  // ─── Flow Versions ───────────────────────────────────────────────────────────

  @Get('flows/:flowId/versions')
  getFlowVersions(@Param('flowId') flowId: string) {
    return this.flowVersionRepo.findByFlowId(flowId);
  }

  @Post('flows/:flowId/promote')
  async promoteFlow(@Param('flowId') flowId: string) {
    // Toma el último snapshot del historial y lo aplica al flow
    const versions = await this.flowVersionRepo.findByFlowId(flowId);
    if (versions.length === 0) throw new BadRequestException('No versions in history to promote');

    const latest = versions[0]; // findByFlowId retorna desc por version
    await this.applySnapshot(flowId, latest.nodesSnapshot as unknown as FlowSnapshot);
    await this.flowVersionRepo.markAsPromoted(latest.id);
    return { promoted: true, flowId, versionId: latest.id };
  }

  @Post('flows/:flowId/restore/:versionId')
  async restoreFlowVersion(
    @Param('flowId') flowId: string,
    @Param('versionId') versionId: string,
  ) {
    const version = await this.flowVersionRepo.findById(versionId);
    if (!version) throw new NotFoundException('Version not found');
    if (version.flowId !== flowId) throw new BadRequestException('Version does not belong to this flow');

    await this.applySnapshot(flowId, version.nodesSnapshot as unknown as FlowSnapshot);
    return { restored: true, flowId, versionId };
  }

  private async applySnapshot(flowId: string, snap: FlowSnapshot | DraftFlowSnapshot): Promise<void> {
    const firstNode = (snap.nodes[0] ?? {}) as any;
    const isDraft = !('id' in firstNode) || firstNode.id === '';

    if (isDraft) {
      const draft = snap as DraftFlowSnapshot;
      await this.nodeRepo.replaceFlowNodes(
        flowId,
        draft.nodes.map((n) => ({ id: '', ...n })),
        draft.transitions,
      );
    } else {
      const promoted = snap as FlowSnapshot;
      const transitions = promoted.transitions.map((t) => {
        const fromNodeIndex = promoted.nodes.findIndex((n) => n.id === t.fromNodeId);
        const toNodeIndex = promoted.nodes.findIndex((n) => n.id === t.toNodeId);
        if (fromNodeIndex === -1 || toNodeIndex === -1) {
          throw new BadRequestException(`Snapshot has invalid transition: ${t.transitionCode}`);
        }
        return { fromNodeIndex, toNodeIndex, transitionCode: t.transitionCode };
      });
      await this.nodeRepo.replaceFlowNodes(flowId, promoted.nodes, transitions);
    }
  }

  // ─── Transitions ─────────────────────────────────────────────────────────────

  @Get('flows/:flowId/transitions')
  getTransitions(@Param('flowId') flowId: string) {
    return this.nodeRepo.findTransitionsByFlowId(flowId);
  }

  @Post('flows/:flowId/transitions')
  createTransition(@Param('flowId') flowId: string, @Body() dto: CreateTransitionDto) {
    return this.nodeRepo.createTransition({ flowId, ...dto });
  }

  @Delete('flows/:flowId/transitions/:id')
  deleteTransition(@Param('id') id: string) {
    return this.nodeRepo.deleteTransition(id);
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
  updateIntent(@Param('id') id: string, @Body() dto: UpdateIntentDto) {
    return this.intentRepo.updateById(id, dto);
  }

  @Delete('intents/:id')
  deleteIntent(@Param('id') id: string) {
    return this.intentRepo.deleteById(id);
  }

  @Get(':id')
  async getNode(@Param('id') id: string) {
    const node = await this.nodeRepo.findById(id);
    if (!node) throw new NotFoundException('Node not found');
    return node;
  }

  @Post()
  async createNode(@Body() body: Prisma.NodeCreateInput) {
    return this.nodeRepo.createNode(body);
  }

  @Put(':id')
  async updateNode(
    @Param('id') id: string,
    @Body() body: Prisma.NodeUpdateInput,
  ) {
    return this.nodeRepo.updateNode(id, body);
  }

  @Post('flow/:flowId/nodes/:nodeId')
  async addNodeToFlow(
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.nodeRepo.addNodeToFlow(flowId, nodeId);
  }

  @Post('test/start')
  async startTest(@Req() req, @Body() dto: TestStartDto) {
    const phone = await this.phoneRepo.findFirstByTenantId(req.user.tenantId);
    if (!phone) {
      throw new BadRequestException('No phone found for user. Connect a phone first.');
    }
    const testId = await this.testSessionService.start(
      dto.conversationId,
      dto.flowId ?? null,
      dto.clientPhone,
      phone.instanceName,
      req.user.tenantId,
    );
    return { testId };
  }

  @Post('test/send')
  async sendTest(@Body() dto: TestSendDto) {
    const session = await this.testSessionService.getSession(dto.testId);

    // Clear any leftover queue result from a previous step
    this.testQueueResultStore.clear(session.conversationId);

    // Ejecutar el mismo workflow de LangGraph en modo test
    const result = await this.workflow.execute(
      {
        messageId: `test-${dto.testId}-${Date.now()}`,
        conversationId: session.conversationId,
        instanceName: session.instanceName,
        clientPhone: session.clientPhone,
        tenantId: session.tenantId,
        messageType: dto.mediaUrl ? MessageType.image : MessageType.text,
        content: dto.message,
        mediaRelativePath: dto.mediaUrl
          ? dto.mediaUrl.replace(/^https?:\/\/[^/]+\//, '')
          : null,
        mediaMetadata: dto.mediaUrl ? { fileName: 'comprobante.jpeg', mimeType: 'image/jpeg' } : null,
      },
      true, // isTest
    );

    // Extraer response del side effect sendMessage si responseText está vacío
    const sendMsg = result.sideEffects.find((se) => se.action === 'sendMessage');
    let response = result.responseText || (sendMsg?.args?.mensaje as string) || '';

    let finalResult = result;
    const allNodeTransitions = [...(result.nodeTransitions ?? [])];

    // Poll in loop — workflows can chain (forwardReceipt → sendToVerification → transitionToNode)
    let currentSideEffects = result.sideEffects;
    while (currentSideEffects.some((se) => se.action === 'waitingQueue')) {
      const queueResult = await this.pollQueueResult(session.conversationId, 15000);
      if (!queueResult) break;
      this.testQueueResultStore.clear(session.conversationId);
      allNodeTransitions.push(...(queueResult.nodeTransitions ?? []));
      finalResult = { ...finalResult, ...queueResult } as any;
      response = queueResult.response || response;
      currentSideEffects = queueResult.sideEffects ?? [];
    }

    // Guardar step en Redis
    const updatedHistory = [
      ...session.history,
      { role: 'user', content: dto.message },
    ];
    if (response) {
      updatedHistory.push({ role: 'assistant', content: response });
    }

    await this.testSessionService.pushStep(dto.testId, {
      message: dto.message,
      response,
      nodeId: (finalResult as any).currentNodeId ?? result.currentNodeId,
      flowId: (finalResult as any).flowId ?? session.flowId,
      historySnapshot: updatedHistory,
    });

    return {
      response,
      intent: (finalResult as any).intent ?? result.intent,
      currentNodeId: (finalResult as any).currentNodeId ?? result.currentNodeId,
      sideEffects: result.sideEffects,
      preCodeContext: (finalResult as any).preCodeContext ?? result.preCodeContext ?? null,
      nodeTransitions: allNodeTransitions,
    };
  }

  /**
   * Polls for an async queue result in test mode.
   * The result is written by AiAgentService after the second workflow completes.
   */
  private async pollQueueResult(conversationId: string, timeoutMs: number): Promise<import('./services/test-queue-result.store').TestQueueResult | null> {
    const interval = 200;
    const maxAttempts = Math.ceil(timeoutMs / interval);
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, interval));
      const result = this.testQueueResultStore.get(conversationId);
      if (result) return result;
    }
    return null;
  }

  @Post('test/step-back')
  async stepBackTest(@Body() dto: TestStepBackDto) {
    const result = await this.testSessionService.popStep(dto.testId);
    if (result.currentNodeId === null && result.lastMessage === null) {
      throw new BadRequestException('No steps to go back to');
    }
    return result;
  }

  @Post('test/stop')
  async stopTest(@Body() dto: TestStopDto) {
    const session = await this.testSessionService.getSession(dto.testId);
    if (!session) {
      throw new NotFoundException('Test session not found');
    }
    this.testQueueResultStore.clear(session.conversationId);
    // Clean up node session from Redis
    const nodeSessionStore = new RedisNodeSessionStore(this.redisService, this.nodeRepo);
    const nodeSession = await nodeSessionStore.findActiveOrWaitingByConversationId(session.conversationId);
    if (nodeSession) {
      await nodeSessionStore.close(nodeSession.id);
    }
    await this.testSessionService.deleteSession(dto.testId);
    return {};
  }
}
