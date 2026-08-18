import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { RedisService } from '@common/redis/redis.service';
import { RedisNodeSessionStore } from '@common/conversation-session/stores/redis-node-session.store';
import { TestQueueResultStore, TestQueueResult } from '@common/conversation-session/test-queue-result.store';
import { TestSessionService } from './test-session.service';
import { AiWorkflow } from './langgraph/workflow';
import { TestStartDto } from './dto/test-start.dto';
import { TestSendDto } from './dto/test-send.dto';
import { TestStepBackDto } from './dto/test-step-back.dto';
import { TestStopDto } from './dto/test-stop.dto';

@Controller('api/nodes/test')
@UseGuards(JwtAuthGuard)
export class FlowTestController {
  constructor(
    private readonly nodeRepo: NodeRepository,
    private readonly phoneRepo: PhoneRepository,
    private readonly redisService: RedisService,
    private readonly testSessionService: TestSessionService,
    private readonly testQueueResultStore: TestQueueResultStore,
    private readonly workflow: AiWorkflow,
  ) {}

  @Post('start')
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

  @Post('send')
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

    // Poll in loop — workflows can chain (sendToInternalChannel → transitionToNode)
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
  private async pollQueueResult(conversationId: string, timeoutMs: number): Promise<TestQueueResult | null> {
    const interval = 200;
    const maxAttempts = Math.ceil(timeoutMs / interval);
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, interval));
      const result = this.testQueueResultStore.get(conversationId);
      if (result) return result;
    }
    return null;
  }

  @Post('step-back')
  async stepBackTest(@Body() dto: TestStepBackDto) {
    const result = await this.testSessionService.popStep(dto.testId);
    if (result.currentNodeId === null && result.lastMessage === null) {
      throw new BadRequestException('No steps to go back to');
    }
    return result;
  }

  @Post('stop')
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
