import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { SessionLifecycleService } from '@common/conversation-session/session-lifecycle.service';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { HitlService } from './hitl.service';
import { TakeControlDto } from './dto/take-control.dto';
import { ReturnToAiDto } from './dto/return-to-ai.dto';

@Controller('api/hitl')
export class HitlController {
  private readonly logger = new Logger(HitlController.name);

  constructor(
    private readonly hitlService: HitlService,
    private readonly conversationRepository: ConversationRepository,
    private readonly sessionLifecycle: SessionLifecycleService,
    private readonly messageRepository: MessageRepository,
  ) {}

  @Post('take-control')
  @UseGuards(JwtAuthGuard)
  async takeControl(@Body() dto: TakeControlDto, @Req() req) {
    const tenantId = req.user.tenantId;

    const conversation = await this.conversationRepository.findByIdWithRelations(dto.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${dto.conversationId} not found`);
    }

    this.hitlService.validateCanTakeControl(conversation, tenantId);

    await this.sessionLifecycle.switchToHitl({
      conversationId: dto.conversationId,
      reason: 'manual_takeover',
      tenantId: req.user.tenantId,
      extras: { userName: req.user.name },
    });

    this.logger.log(`User ${req.user.id} took control of conversation ${dto.conversationId}`);
    return { message: 'Control taken successfully' };
  }

  @Post('return-to-ai')
  @UseGuards(JwtAuthGuard)
  async returnToAi(@Body() dto: ReturnToAiDto, @Req() req) {
    const tenantId = req.user.tenantId;

    const conversation = await this.conversationRepository.findByIdWithRelations(dto.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${dto.conversationId} not found`);
    }

    this.hitlService.validateCanReturnToAi(conversation, tenantId);

    const messages = await this.messageRepository.findByConversationId(dto.conversationId);

    await this.sessionLifecycle.returnToAi({
      conversationId: dto.conversationId,
      tenantId: req.user.tenantId,
      messages,
    });

    this.logger.log(`User ${req.user.id} returned conversation ${dto.conversationId} to AI`);
    return { message: 'Returned to AI successfully' };
  }
}
