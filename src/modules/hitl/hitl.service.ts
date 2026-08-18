import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Conversation, Phone } from '@prisma/client';
import { checkTenantOwnsConversation } from '@common/utils/check-tenant-owns-conversation';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { SessionLifecycleService } from '@common/conversation-session/session-lifecycle.service';
import { MessageRepository } from '@common/messaging/repositories/message.repository';

interface AuthenticatedUser {
  id: string;
  name: string;
  tenantId: string;
}

@Injectable()
export class HitlService {
  private readonly logger = new Logger(HitlService.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly sessionLifecycle: SessionLifecycleService,
    private readonly messageRepository: MessageRepository,
  ) {}

  validateCanTakeControl(
    conversation: Conversation & { phone: Phone },
    tenantId: string,
  ) {
    checkTenantOwnsConversation(conversation, conversation.phone, tenantId);
    if (conversation.mode === 'HITL') {
      throw new BadRequestException('Conversation is already in HITL mode');
    }
  }

  validateCanReturnToAi(
    conversation: Conversation & { phone: Phone },
    tenantId: string,
  ) {
    checkTenantOwnsConversation(conversation, conversation.phone, tenantId);
    if (conversation.mode === 'AI') {
      throw new BadRequestException('Conversation is already in AI mode');
    }
  }

  async takeControl(conversationId: string, user: AuthenticatedUser) {
    const conversation = await this.conversationRepository.findByIdWithRelations(conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    this.validateCanTakeControl(conversation, user.tenantId);

    await this.sessionLifecycle.switchToHitl({
      conversationId,
      reason: 'manual_takeover',
      tenantId: user.tenantId,
      extras: { userName: user.name },
    });

    this.logger.log(`User ${user.id} took control of conversation ${conversationId}`);
    return { message: 'Control taken successfully' };
  }

  async returnToAi(conversationId: string, user: AuthenticatedUser) {
    const conversation = await this.conversationRepository.findByIdWithRelations(conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    this.validateCanReturnToAi(conversation, user.tenantId);

    const messages = await this.messageRepository.findByConversationId(conversationId);

    await this.sessionLifecycle.returnToAi({
      conversationId,
      tenantId: user.tenantId,
      messages,
    });

    this.logger.log(`User ${user.id} returned conversation ${conversationId} to AI`);
    return { message: 'Returned to AI successfully' };
  }
}
