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
import { ProductRepository } from '@modules/conversation-analysis/repositories/product.repository';
import { DiscountRepository } from '@modules/conversation-analysis/repositories/discount.repository';
import { PromotionRepository } from '@modules/conversation-analysis/repositories/promotion.repository';
import { PromotionDiscountRepository } from '@modules/conversation-analysis/repositories/promotion-discount.repository';

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

    // 1. Obtener conversación con relaciones (phone + participants → client)
    const conversation = await this.conversationRepository.findByIdWithRelations(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation with id ${id} not found`);
    }

    // 2. Validar permisos (Service - lógica pura)
    this.conversationsService.checkUserOwnsConversation(
      conversation,
      conversation.phone,
      userId,
    );

    // 3. Construir response base (Service - lógica pura)
    const response = this.conversationsService.buildDetailResponse(
      conversation,
      conversation.client,
    );

    // 4. Enriquecer con datos de negocio del Client
    const clientId = conversation.client?.id;
    const [products, clientDiscounts, clientPromotionDiscounts] =
      await Promise.all([
        this.productRepository.findByUserId(userId),
        clientId
          ? this.discountRepository.findByClientId(clientId)
          : Promise.resolve([]),
        clientId
          ? this.promotionDiscountRepository.findByClientId(clientId)
          : Promise.resolve([]),
      ]);

    // 5. Obtener promociones del usuario
    const promotions = await this.promotionRepository.findByUserId(userId);

    this.logger.log(`Conversation detail retrieved successfully for id: ${id}`);

    return {
      ...response,
      products,
      clientDiscounts,
      promotions,
      clientPromotionDiscounts,
    };
  }
}
