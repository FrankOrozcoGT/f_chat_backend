import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  Logger,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { ConversationRepository } from './repositories/conversation.repository';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { ConversationsService } from './conversations.service';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from '@modules/webhooks/repositories/client.repository';
import { EvolutionService } from '@common/evolution/evolution.service';

@Controller('api/conversations')
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly conversationsService: ConversationsService,
    private readonly phoneRepository: PhoneRepository,
    private readonly clientRepository: ClientRepository,
    private readonly evolutionService: EvolutionService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req,
    @Query('phoneId') phoneId?: string,
  ): Promise<ConversationResponseDto[]> {
    const userId = req.user.id;

    this.logger.log(`GET /api/conversations - userId: ${userId}, phoneId: ${phoneId || 'all'}`);

    const conversations = await this.conversationRepository.findByUserIdAndPhone(userId, phoneId);

    if (conversations.length > 0) {
      return conversations.map((conversation) => new ConversationResponseDto(conversation));
    }

    // Fallback: consultar Evolution contacts si no hay conversaciones en DB
    const phone = phoneId
      ? await this.phoneRepository.findById(phoneId)
      : await this.phoneRepository.findAllByUserId(userId).then((phones) => phones[0] ?? null);

    if (!phone) {
      this.logger.warn(`No phone found for userId: ${userId}, returning empty list`);
      return [];
    }

    this.logger.log(`No conversations in DB, falling back to Evolution contacts for phone: ${phone.instanceName}`);
    const contacts = await this.evolutionService.findContacts(phone.instanceName);
    return this.conversationsService.mapContactsToConversations(contacts, phone);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getDetail(@Param('id') id: string, @Req() req) {
    const userId = req.user.id;

    this.logger.log(`GET /api/conversations/:id - userId: ${userId}, conversationId: ${id}`);

    // 1. Obtener conversación por ID
    const conversation = await this.conversationRepository.findById(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation with id ${id} not found`);
    }

    // 2. Obtener phone asociado
    const phone = await this.phoneRepository.findById(conversation.phoneId);
    if (!phone) {
      throw new NotFoundException(`Phone associated with conversation not found`);
    }

    // 3. Validar permisos (Service - lógica pura)
    this.conversationsService.checkUserOwnsConversation(conversation, phone, userId);

    // 4. Obtener client asociado
    const client = await this.clientRepository.findById(conversation.clientId);

    // 5. Construir response (Service - lógica pura)
    const response = this.conversationsService.buildDetailResponse(conversation, client);

    this.logger.log(`Conversation detail retrieved successfully for id: ${id}`);

    return response;
  }
}
