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
import { Phone } from '@prisma/client';

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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const userId = req.user.id;

    this.logger.log(`GET /api/conversations - userId: ${userId}, phoneId: ${phoneId || 'all'}, page: ${page}, search: ${search || 'none'}`);

    const options = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
    };

    const { data, total, page: currentPage, limit: currentLimit } =
      await this.conversationRepository.findByUserIdAndPhone(userId, phoneId, options);

    if (data.length > 0) {
      return {
        data: data.map((conversation) => new ConversationResponseDto(conversation)),
        total,
        page: currentPage,
        limit: currentLimit,
        totalPages: Math.ceil(total / currentLimit),
      };
    }

    // Fallback: consultar Evolution contacts si no hay conversaciones en DB
    const phone = phoneId
      ? await this.phoneRepository.findById(phoneId)
      : await this.phoneRepository.findAllByUserId(userId).then((phones) => phones[0] ?? null);

    if (!phone) {
      this.logger.warn(`No phone found for userId: ${userId}, returning empty list`);
      return { data: [], total: 0, page: currentPage, limit: currentLimit, totalPages: 0 };
    }

    this.logger.log(`No conversations in DB, falling back to Evolution contacts for phone: ${phone.instanceName}`);
    const contacts = await this.evolutionService.findContacts(phone.instanceName);

    // Persistir todos los contacts como clients + conversations en background
    this.bootstrapContactsInBackground(contacts, phone);

    const mapped = this.conversationsService.mapContactsToConversations(contacts, phone);

    // Aplicar search y paginación sobre el fallback
    const filtered = search
      ? mapped.filter((c) =>
          c.client?.name?.toLowerCase().includes(search.toLowerCase()) ||
          c.client?.phoneNumber?.includes(search),
        )
      : mapped;

    const paginatedData = filtered.slice((currentPage - 1) * currentLimit, currentPage * currentLimit);

    return {
      data: paginatedData,
      total: filtered.length,
      page: currentPage,
      limit: currentLimit,
      totalPages: Math.ceil(filtered.length / currentLimit),
    };
  }

  private async bootstrapContactsInBackground(contacts: any[], phone: Phone) {
    try {
      const filtered = contacts.filter((c) => c.remoteJid?.endsWith('@s.whatsapp.net'));
      for (const c of filtered) {
        const phoneNumber = c.remoteJid.replace('@s.whatsapp.net', '');
        const client = await this.clientRepository.upsert({
          phoneNumber,
          name: c.pushName || c.notify || phoneNumber,
        });
        await this.conversationRepository.upsert({
          phoneId: phone.id,
          clientId: client.id,
          isActive: true,
        });
      }
      this.logger.log(`Background: bootstrapped ${filtered.length} contacts for phone ${phone.id}`);
    } catch (err) {
      this.logger.error(`Background contacts bootstrap failed: ${err.message}`);
    }
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
