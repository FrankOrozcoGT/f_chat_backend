import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Conversation, Phone, Message } from '@prisma/client';

@Injectable()
export class MessagesService {
  constructor(private readonly configService: ConfigService) {}
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
   * Construye URLs completas para los mediaUrl de los mensajes
   * @param messages - Lista de mensajes con mediaUrl relativos
   * @returns Mensajes con mediaUrl completos (con dominio)
   */
  buildMessagesWithFullUrls(messages: Message[]): Message[] {
    const backendUrl = this.configService.get<string>('BACKEND_URL');

    return messages.map(message => ({
      ...message,
      mediaUrl: message.mediaUrl ? `${backendUrl}${message.mediaUrl}` : null,
    }));
  }
}
