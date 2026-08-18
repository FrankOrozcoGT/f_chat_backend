import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { RedisService } from '@common/redis/redis.service';
import { RedisNodeSessionStore } from '@common/conversation-session/stores/redis-node-session.store';
import { TestQueueResultStore } from '@common/conversation-session/test-queue-result.store';
import { TestSessionService } from './test-session.service';
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
    return this.testSessionService.sendMessage(dto.testId, dto.message, dto.mediaUrl);
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
