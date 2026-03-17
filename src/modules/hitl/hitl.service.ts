import { Injectable, BadRequestException } from '@nestjs/common';
import { Conversation, Phone } from '@prisma/client';

@Injectable()
export class HitlService {
  validateCanTakeControl(
    conversation: Conversation & { phone: Phone },
    tenantId: string,
  ) {
    if (conversation.phone.tenantId !== tenantId) {
      throw new BadRequestException('You do not own this conversation');
    }
    if (conversation.mode === 'HITL') {
      throw new BadRequestException('Conversation is already in HITL mode');
    }
  }

  validateCanReturnToAi(
    conversation: Conversation & { phone: Phone },
    tenantId: string,
  ) {
    if (conversation.phone.tenantId !== tenantId) {
      throw new BadRequestException('You do not own this conversation');
    }
    if (conversation.mode === 'AI') {
      throw new BadRequestException('Conversation is already in AI mode');
    }
  }
}
