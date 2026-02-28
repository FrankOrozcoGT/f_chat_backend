import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { ConversationRepository } from './repositories/conversation.repository';

@Controller('internal/conversations')
@UseGuards(InternalGuard)
export class InternalConversationsController {
  constructor(
    private readonly conversationRepository: ConversationRepository,
  ) {}

  @Get(':id')
  async getConversation(@Param('id') id: string) {
    const conversation =
      await this.conversationRepository.findByIdWithRelations(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return { id: conversation.id, phone: { userId: conversation.phone.userId } };
  }

  @Patch(':id/mode')
  async updateMode(
    @Param('id') id: string,
    @Body('mode') mode: 'AI' | 'HITL',
  ) {
    await this.conversationRepository.updateMode(id, mode);
  }
}
