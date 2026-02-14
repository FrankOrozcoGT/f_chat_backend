import { Injectable, ForbiddenException } from '@nestjs/common';
import { Conversation, Client, Phone } from '@prisma/client';

@Injectable()
export class ConversationsService {
  /**
   * Valida que el usuario sea dueño de la conversación (vía phone)
   * @param conversation - Conversación a validar
   * @param phone - Teléfono asociado a la conversación
   * @param userId - ID del usuario autenticado
   * @throws ForbiddenException si el usuario no es dueño
   */
  checkUserOwnsConversation(
    conversation: Conversation,
    phone: Phone,
    userId: string,
  ): void {
    if (phone.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to access this conversation',
      );
    }
  }

  /**
   * Construye el response de detalle de conversación
   * @param conversation - Conversación
   * @param client - Cliente asociado
   * @returns Objeto con conversation, client y summary
   */
  buildDetailResponse(conversation: Conversation, client: Client | null) {
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
