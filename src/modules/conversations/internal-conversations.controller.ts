import {
  Controller,
  Get,
  Post,
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
    return { id: conversation.id, phone: { tenantId: conversation.phone.tenantId } };
  }

  @Get(':id/full')
  async getConversationFull(@Param('id') id: string) {
    const conversation =
      await this.conversationRepository.findByIdWithRelations(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }

  @Patch(':id/mode')
  async updateMode(
    @Param('id') id: string,
    @Body('mode') mode: 'AI' | 'HITL',
  ) {
    await this.conversationRepository.updateMode(id, mode);
  }

  @Patch(':id/summary')
  async updateSummary(
    @Param('id') id: string,
    @Body('summary') summary: string,
  ) {
    return this.conversationRepository.updateSummary(id, summary);
  }

  @Post('create-with-participant')
  async createWithParticipant(
    @Body() body: {
      phoneId: string;
      clientId: string;
      summary?: string;
      isActive: boolean;
    },
  ) {
    return this.conversationRepository.createWithParticipant(body);
  }
}
