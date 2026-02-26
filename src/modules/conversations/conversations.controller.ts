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

@Controller('api/conversations')
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly conversationsService: ConversationsService,
    private readonly phoneRepository: PhoneRepository,
    private readonly clientRepository: ClientRepository,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req,
    @Query('phoneId') phoneId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const userId = req.user.id;

    this.logger.log(
      `GET /api/conversations - userId: ${userId}, phoneId: ${phoneId || 'all'}, page: ${page}, search: ${search || 'none'}`,
    );

    const options = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
    };

    const {
      data,
      total,
      page: currentPage,
      limit: currentLimit,
    } = await this.conversationRepository.findByUserIdAndPhone(
      userId,
      phoneId,
      options,
    );

    if (data.length > 0) {
      return {
        data: data.map(
          (conversation) => new ConversationResponseDto(conversation),
        ),
        total,
        page: currentPage,
        limit: currentLimit,
        totalPages: Math.ceil(total / currentLimit),
      };
    }

    // Sin conversaciones en DB — el sync viene via webhook contacts.upsert
    this.logger.log(
      `No conversations in DB for userId=${userId}, sync pending via webhook`,
    );
    return {
      data: [],
      total: 0,
      page: currentPage,
      limit: currentLimit,
      totalPages: 0,
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getDetail(@Param('id') id: string, @Req() req) {
    const userId = req.user.id;

    this.logger.log(
      `GET /api/conversations/:id - userId: ${userId}, conversationId: ${id}`,
    );

    // 1. Obtener conversación por ID
    const conversation = await this.conversationRepository.findById(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation with id ${id} not found`);
    }

    // 2. Obtener phone asociado
    const phone = await this.phoneRepository.findById(conversation.phoneId);
    if (!phone) {
      throw new NotFoundException(
        `Phone associated with conversation not found`,
      );
    }

    // 3. Validar permisos (Service - lógica pura)
    this.conversationsService.checkUserOwnsConversation(
      conversation,
      phone,
      userId,
    );

    // 4. Obtener client asociado (null para grupos)
    const client = conversation.clientId
      ? await this.clientRepository.findById(conversation.clientId)
      : null;

    // 5. Construir response (Service - lógica pura)
    const response = this.conversationsService.buildDetailResponse(
      conversation,
      client,
    );

    this.logger.log(`Conversation detail retrieved successfully for id: ${id}`);

    return response;
  }
}
