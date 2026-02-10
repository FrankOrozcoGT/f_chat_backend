import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { MessagesService } from './messages.service';

@Controller('api/messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly phoneRepository: PhoneRepository,
    private readonly messagesService: MessagesService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Query('conversationId') conversationId: string, @Req() req) {
    const userId = req.user.id;

    this.logger.log(
      `GET /api/messages - userId: ${userId}, conversationId: ${conversationId}`,
    );

    // 1. Validar que conversationId existe
    if (!conversationId) {
      throw new BadRequestException('conversationId query parameter is required');
    }

    // 2. Obtener conversación por ID
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    // 3. Obtener phone asociado
    const phone = await this.phoneRepository.findById(conversation.phoneId);
    if (!phone) {
      throw new NotFoundException(
        `Phone associated with conversation not found`,
      );
    }

    // 4. Validar permisos (Service - lógica pura)
    this.messagesService.checkUserOwnsConversation(conversation, phone, userId);

    // 5. Obtener mensajes
    const messages = await this.messageRepository.findByConversationId(
      conversationId,
    );

    // 6. Construir URLs completas para mediaUrl
    const messagesWithFullUrls = this.messagesService.buildMessagesWithFullUrls(messages);

    this.logger.log(
      `Retrieved ${messages.length} messages for conversation ${conversationId}`,
    );

    return messagesWithFullUrls;
  }
}
