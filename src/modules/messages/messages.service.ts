import { Injectable, ForbiddenException } from '@nestjs/common';
import { Conversation, Phone } from '@prisma/client';

@Injectable()
export class MessagesService {
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
}
