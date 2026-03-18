import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { SessionLifecycleService } from '@modules/ai/services/session-lifecycle.service';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
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
    private readonly phoneRepository: PhoneRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Post('take-control')
  @UseGuards(JwtAuthGuard)
  async takeControl(@Body() dto: TakeControlDto, @Req() req) {
    const tenantId = req.user.tenantId;

    const conversation =
      await this.conversationRepository.findByIdWithRelations(
        dto.conversationId,
      );
    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${dto.conversationId} not found`,
      );
    }

    this.hitlService.validateCanTakeControl(conversation, tenantId);

    await this.sessionLifecycle.switchToHitl({
      conversationId: dto.conversationId,
      reason: 'manual_takeover',
      tenantId: req.user.tenantId,
      extras: { userName: req.user.name },
    });

    this.logger.log(
      `User ${req.user.id} took control of conversation ${dto.conversationId}`,
    );

    return { message: 'Control taken successfully' };
  }

  @Post('return-to-ai')
  @UseGuards(JwtAuthGuard)
  async returnToAi(@Body() dto: ReturnToAiDto, @Req() req) {
    const tenantId = req.user.tenantId;

    const conversation =
      await this.conversationRepository.findByIdWithRelations(
        dto.conversationId,
      );
    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${dto.conversationId} not found`,
      );
    }

    this.hitlService.validateCanReturnToAi(conversation, tenantId);

    await this.sessionLifecycle.returnToAi({
      conversationId: dto.conversationId,
      tenantId: req.user.tenantId,
    });

    // Verificar si el último mensaje es del cliente para re-trigger AI
    const messages = await this.messageRepository.findByConversationId(
      dto.conversationId,
    );
    if (messages && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];

      if (
        lastMessage.direction === 'incoming' &&
        lastMessage.senderType === 'client'
      ) {
        this.logger.log(
          `Last message from client, triggering AI processing for conversation ${dto.conversationId} (fromHitl=true, messageCount=${messages.length})`,
        );

        const phone = await this.phoneRepository.findById(conversation.phoneId);
        if (phone && conversation.client) {
          // fromHitl=true activates entry_checker when there are >1 messages
          this.eventEmitter.emit('ai.incoming.message', {
            messageId: lastMessage.id,
            conversationId: conversation.id,
            instanceName: phone.evolutionInstanceId,
            clientPhone: conversation.client.phoneNumber,
            tenantId: phone.tenantId,
            messageType: lastMessage.type,
            content: lastMessage.content,
            mediaRelativePath: lastMessage.mediaUrl || null,
            mediaMetadata: lastMessage.fileName
              ? {
                  fileName: lastMessage.fileName,
                  mimeType: lastMessage.mimeType,
                }
              : null,
            fromHitl: messages.length > 1,
          });
        }
      }
    }

    this.logger.log(
      `User ${req.user.id} returned conversation ${dto.conversationId} to AI`,
    );

    return { message: 'Returned to AI successfully' };
  }
}
