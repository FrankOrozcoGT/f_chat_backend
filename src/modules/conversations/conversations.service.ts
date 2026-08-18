import { Injectable } from '@nestjs/common';
import { Client, Phone, ConversationMode } from '@prisma/client';
import { ConversationResponseDto } from './dto/conversation-response.dto';

@Injectable()
export class ConversationsService {
  /**
   * Construye el response de detalle de conversación
   * @param conversation - Conversación
   * @param client - Cliente asociado
   * @returns Objeto con conversation, client y summary
   */
  mapContactsToConversations(
    contacts: any[],
    phone: Phone,
  ): ConversationResponseDto[] {
    const now = new Date();
    return contacts
      .filter((c) => c.remoteJid?.endsWith('@s.whatsapp.net'))
      .map((c) => {
        const client = {
          id: c.remoteJid,
          phoneNumber: c.remoteJid.replace(/@s\.whatsapp\.net$/, ''),
          name: c.pushName || c.notify || null,
          profilePicUrl: c.profilePicUrl || null,
          firstContactAt: now,
          lastContactAt: now,
        } as Client;

        return new ConversationResponseDto({
          id: c.remoteJid,
          phoneId: phone.id,
          type: 'individual',
          mode: ConversationMode.HITL,
          lastMessageAt: now,
          lastMessagePreview: null,
          isActive: true,
          summary: null,
          createdAt: now,
          updatedAt: now,
          client,
          phone,
        });
      });
  }

  buildDetailResponse(conversation: { id: string; lastMessageAt: Date; lastMessagePreview: string | null; isActive: boolean; mode: string }, client: Client | null) {
    const summary = {
      conversationId: conversation.id,
      clientName: client?.name || 'Unknown',
      clientPhone: client?.phoneNumber || 'N/A',
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      isActive: conversation.isActive,
      mode: conversation.mode,
    };

    return {
      conversation,
      client,
      summary,
    };
  }
}
