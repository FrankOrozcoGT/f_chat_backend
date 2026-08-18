import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConversationRepository } from './repositories/conversation.repository';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { ProductRepository } from '@modules/catalog/repositories/product.repository';
import { DiscountRepository } from '@modules/catalog/repositories/discount.repository';
import { PromotionRepository } from '@modules/catalog/repositories/promotion.repository';
import { PromotionDiscountRepository } from '@modules/catalog/repositories/promotion-discount.repository';
import { NodeSessionRepository } from '@common/conversation-session/node-session.repository';
import { QueueRequestRepository } from '@modules/queue-system/repositories/queue-request.repository';
import { checkTenantOwnsConversation } from '@common/utils/check-tenant-owns-conversation';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly productRepository: ProductRepository,
    private readonly discountRepository: DiscountRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly promotionDiscountRepository: PromotionDiscountRepository,
    private readonly nodeSessionRepository: NodeSessionRepository,
    private readonly queueRequestRepository: QueueRequestRepository,
  ) {}

  async findAll(
    tenantId: string,
    phoneId?: string,
    page?: string,
    limit?: string,
    search?: string,
  ) {
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

  getGroupsSelect(tenantId: string) {
    return this.conversationRepository.findAllGroupsSelect(tenantId);
  }

  async getDetail(id: string, tenantId: string) {
    this.logger.log(
      `GET /api/conversations/:id - tenantId: ${tenantId}, conversationId: ${id}`,
    );

    // 1. Obtener conversación con relaciones (phone + participants → client)
    const conversation = await this.conversationRepository.findByIdWithRelations(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation with id ${id} not found`);
    }

    // 2. Validar permisos
    checkTenantOwnsConversation(conversation, conversation.phone, tenantId);

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

  async closeConversation(id: string, tenantId: string) {
    const conversation = await this.conversationRepository.findWithMessagesById(id);
    if (!conversation) throw new NotFoundException(`Conversation ${id} not found`);

    checkTenantOwnsConversation(conversation, conversation.phone, tenantId);

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

  async markAsRead(id: string, tenantId: string) {
    const conversation = await this.conversationRepository.findByIdWithRelations(id);
    if (!conversation) throw new NotFoundException(`Conversation ${id} not found`);

    checkTenantOwnsConversation(conversation, conversation.phone, tenantId);

    await this.conversationRepository.resetUnread(id);
    return { ok: true };
  }
}
