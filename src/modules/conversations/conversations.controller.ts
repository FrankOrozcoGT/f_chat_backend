import {
  Controller,
  Get,
  Post,
  Patch,
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
import { ProductRepository } from '@modules/catalog/repositories/product.repository';
import { DiscountRepository } from '@modules/catalog/repositories/discount.repository';
import { PromotionRepository } from '@modules/catalog/repositories/promotion.repository';
import { PromotionDiscountRepository } from '@modules/catalog/repositories/promotion-discount.repository';
import { NodeSessionRepository } from '@modules/nodes/repositories/node-session.repository';
import { QueueRequestRepository } from '@modules/queue-system/repositories/queue-request.repository';

@Controller('api/conversations')
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly conversationsService: ConversationsService,
    private readonly productRepository: ProductRepository,
    private readonly discountRepository: DiscountRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly promotionDiscountRepository: PromotionDiscountRepository,
    private readonly nodeSessionRepository: NodeSessionRepository,
    private readonly queueRequestRepository: QueueRequestRepository,
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
    const tenantId = req.user.tenantId;

    this.logger.log(
      `GET /api/conversations - tenantId: ${tenantId}, phoneId: ${phoneId || 'all'}, page: ${page}, search: ${search || 'none'}`,
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
    } = await this.conversationRepository.findByTenantIdAndPhone(
      tenantId,
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
      `No conversations in DB for tenantId=${tenantId}, sync pending via webhook`,
    );
    return {
      data: [],
      total: 0,
      page: currentPage,
      limit: currentLimit,
      totalPages: 0,
    };
  }

  @Get('groups/select')
  @UseGuards(JwtAuthGuard)
  async getGroupsSelect(@Req() req) {
    return this.conversationRepository.findAllGroupsSelect(req.user.tenantId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getDetail(@Param('id') id: string, @Req() req) {
    const tenantId = req.user.tenantId;

    this.logger.log(
      `GET /api/conversations/:id - tenantId: ${tenantId}, conversationId: ${id}`,
    );

    // 1. Obtener conversación con relaciones (phone + participants → client)
    const conversation = await this.conversationRepository.findByIdWithRelations(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation with id ${id} not found`);
    }

    // 2. Validar permisos (Service - lógica pura)
    this.conversationsService.checkTenantOwnsConversation(
      conversation,
      conversation.phone,
      tenantId,
    );

    // 3. Datos del cliente
    const clientId = conversation.client?.id;

    // 4. Cargar en paralelo: productos, descuentos, promociones, sub-conversaciones analizadas
    const [products, clientDiscounts, clientPromotionDiscounts, analyzedConversations] =
      await Promise.all([
        this.productRepository.findByTenantId(tenantId),
        clientId
          ? this.discountRepository.findByClientId(clientId)
          : Promise.resolve([]),
        clientId
          ? this.promotionDiscountRepository.findByClientId(clientId)
          : Promise.resolve([]),
        clientId
          ? this.conversationRepository.findAnalyzedByPhoneAndClient(
              conversation.phoneId,
              clientId,
            )
          : Promise.resolve([]),
      ]);

    // 5. Obtener promociones del usuario
    const promotions = await this.promotionRepository.findByTenantId(tenantId);

    this.logger.log(`Conversation detail retrieved successfully for id: ${id}`);

    return {
      conversation: {
        id: conversation.id,
        phoneId: conversation.phoneId,
        isActive: conversation.isActive,
        mode: conversation.mode,
        lastMessageAt: conversation.lastMessageAt,
        lastMessagePreview: conversation.lastMessagePreview,
      },
      client: conversation.client
        ? {
            id: conversation.client.id,
            name: conversation.client.name,
            phoneNumber: conversation.client.phoneNumber,
          }
        : null,
      products,
      clientDiscounts,
      promotions,
      clientPromotionDiscounts,
      analyzedConversations: analyzedConversations.map((c) => ({
        id: c.id,
        summary: c.summary,
        messageCount: c._count.messages,
        createdAt: c.createdAt,
      })),
    };
  }

  @Post(':id/close')
  @UseGuards(JwtAuthGuard)
  async closeConversation(@Param('id') id: string, @Req() req) {
    const tenantId = req.user.tenantId;

    const conversation = await this.conversationRepository.findWithMessagesById(id);
    if (!conversation) throw new NotFoundException(`Conversation ${id} not found`);

    this.conversationsService.checkTenantOwnsConversation(conversation, conversation.phone, tenantId);

    if (!conversation.client || conversation.messages.length === 0) {
      return { closed: true, movedMessages: 0 };
    }

    const messageIds = conversation.messages.map((m) => m.id);
    const result = await this.conversationRepository.archiveMessages(
      conversation.phoneId,
      conversation.client.id,
      messageIds,
    );

    const activeSession = await this.nodeSessionRepository.findActiveOrWaitingByConversationId(id);
    if (activeSession) {
      await this.nodeSessionRepository.close(activeSession.id);
    }

    await this.queueRequestRepository.cancelByConversationId(id);

    return { closed: true, movedMessages: result.messageCount, subConversationId: result.subConversationId };
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  async markAsRead(@Param('id') id: string, @Req() req) {
    const tenantId = req.user.tenantId;

    const conversation = await this.conversationRepository.findByIdWithRelations(id);
    if (!conversation) throw new NotFoundException(`Conversation ${id} not found`);

    this.conversationsService.checkTenantOwnsConversation(conversation, conversation.phone, tenantId);

    await this.conversationRepository.resetUnread(id);
    return { ok: true };
  }
}
