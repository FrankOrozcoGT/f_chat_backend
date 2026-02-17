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
import { SessionRepository } from '@modules/ai/repositories/session.repository';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
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
    private readonly sessionRepository: SessionRepository,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly messageRepository: MessageRepository,
    private readonly phoneRepository: PhoneRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Post('take-control')
  @UseGuards(JwtAuthGuard)
  async takeControl(@Body() dto: TakeControlDto, @Req() req) {
    const userId = req.user.id;

    const conversation = await this.conversationRepository.findByIdWithRelations(dto.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${dto.conversationId} not found`);
    }

    this.hitlService.validateCanTakeControl(conversation, userId);

    await this.conversationRepository.updateMode(dto.conversationId, 'HITL');

    const activeSession = await this.sessionRepository.findActiveByConversationId(dto.conversationId);
    if (activeSession) {
      await this.sessionRepository.close(activeSession.id, 'manual_takeover', userId);
    }

    await this.sessionRepository.createHitl(dto.conversationId, userId);

    this.websocketGateway.emit('conversation:taken', {
      conversationId: dto.conversationId,
      userId,
      userName: req.user.name,
      timestamp: new Date().toISOString(),
    }, userId);

    this.logger.log(`User ${userId} took control of conversation ${dto.conversationId}`);

    return { message: 'Control taken successfully' };
  }

  @Post('return-to-ai')
  @UseGuards(JwtAuthGuard)
  async returnToAi(@Body() dto: ReturnToAiDto, @Req() req) {
    const userId = req.user.id;

    const conversation = await this.conversationRepository.findByIdWithRelations(dto.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${dto.conversationId} not found`);
    }

    this.hitlService.validateCanReturnToAi(conversation, userId);

    await this.conversationRepository.updateMode(dto.conversationId, 'AI');

    const activeSession = await this.sessionRepository.findActiveHitlByConversationId(dto.conversationId);
    if (activeSession) {
      await this.sessionRepository.close(activeSession.id, 'returned_to_ai', userId);
    }

    await this.sessionRepository.create(dto.conversationId);

    // Verificar si el último mensaje es del cliente
    const messages = await this.messageRepository.findByConversationId(dto.conversationId);
    if (messages && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];

      // Si el último mensaje es del cliente (incoming y senderType client), enviarlo a la IA
      if (lastMessage.direction === 'incoming' && lastMessage.senderType === 'client') {
        this.logger.log(`Last message from client, triggering AI processing for conversation ${dto.conversationId}`);

        // Obtener phone para instanceName y clientPhone
        const phone = await this.phoneRepository.findById(conversation.phoneId);
        if (phone) {
          // Emitir evento para que el agente IA lo procese como si viniera del webhook
          this.eventEmitter.emit('ai.incoming.message', {
            messageId: lastMessage.id,
            conversationId: conversation.id,
            instanceName: phone.evolutionInstanceId,
            clientPhone: conversation.client.phoneNumber,
            userId: phone.userId,
            messageType: lastMessage.type,
            content: lastMessage.content,
            mediaRelativePath: lastMessage.mediaUrl || null,
            mediaMetadata: lastMessage.fileName ? {
              fileName: lastMessage.fileName,
              mimeType: lastMessage.mimeType,
            } : null,
          });

          this.logger.log(`Emitted ai.incoming.message for conversation ${dto.conversationId}`);
        }
      } else {
        this.logger.log(`Last message is not from client (direction: ${lastMessage.direction}, senderType: ${lastMessage.senderType}), skipping AI processing`);
      }
    }

    this.websocketGateway.emit('conversation:returned', {
      conversationId: dto.conversationId,
      timestamp: new Date().toISOString(),
    }, userId);

    this.logger.log(`User ${userId} returned conversation ${dto.conversationId} to AI`);

    return { message: 'Returned to AI successfully' };
  }
}
