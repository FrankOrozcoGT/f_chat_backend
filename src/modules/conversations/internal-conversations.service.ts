import { Injectable, NotFoundException } from '@nestjs/common';
import { ConversationRepository } from './repositories/conversation.repository';

@Injectable()
export class InternalConversationsService {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  async getConversation(id: string) {
    const conversation = await this.findOrThrow(id);
    return { id: conversation.id, phone: { tenantId: conversation.phone.tenantId } };
  }

  async getConversationFull(id: string) {
    return this.findOrThrow(id);
  }

  async updateMode(id: string, mode: 'AI' | 'HITL'): Promise<void> {
    await this.conversationRepository.updateMode(id, mode);
  }

  async updateSummary(id: string, summary: string) {
    return this.conversationRepository.updateSummary(id, summary);
  }

  async createWithParticipant(data: {
    phoneId: string;
    clientId: string;
    summary?: string;
    isActive: boolean;
  }) {
    return this.conversationRepository.createWithParticipant(data);
  }

  private async findOrThrow(id: string) {
    const conversation = await this.conversationRepository.findByIdWithRelations(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }
}
