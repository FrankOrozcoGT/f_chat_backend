import {
  Controller,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { ProductRepository } from './repositories/product.repository';
import { DiscountRepository } from './repositories/discount.repository';
import { PromotionRepository } from './repositories/promotion.repository';
import { PromotionDiscountRepository } from './repositories/promotion-discount.repository';

@Controller('internal/catalog')
@UseGuards(InternalGuard)
export class InternalCatalogController {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly discountRepository: DiscountRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly promotionDiscountRepository: PromotionDiscountRepository,
  ) {}

  @Post('products/upsert')
  async upsertProduct(
    @Body() body: { userId: string; name: string; basePrice: number; description?: string },
  ) {
    return this.productRepository.upsertByName(body.userId, body.name, {
      basePrice: body.basePrice,
      description: body.description,
    });
  }

  @Post('products/find')
  async findProduct(
    @Body() body: { userId: string; name: string },
  ) {
    return this.productRepository.findByUserIdAndName(body.userId, body.name);
  }

  @Post('discounts/upsert')
  async upsertDiscount(
    @Body() body: { productId: string; clientId?: string | null; discountPrice: number },
  ) {
    return this.discountRepository.upsert(body);
  }

  @Post('promotions/create')
  async createPromotion(
    @Body() body: {
      userId: string;
      name?: string;
      description?: string;
      specialPrice: number;
      productIds: string[];
    },
  ) {
    return this.promotionRepository.create(body);
  }

  @Post('promotion-discounts/upsert')
  async upsertPromotionDiscount(
    @Body() body: { promotionId: string; clientId?: string | null; discountPrice: number },
  ) {
    return this.promotionDiscountRepository.upsert(body);
  }

  /**
   * Procesa productos y promociones extraídos del análisis de conversación.
   * Lógica de precio: si el precio nuevo es menor al base existente → crea descuento para el cliente.
   */
  @Post('process-analysis-catalog')
  async processAnalysisCatalog(
    @Body()
    body: {
      userId: string;
      clientId: string | null;
      products: Array<{
        name: string;
        price: number;
        description?: string;
      }>;
      promotions: Array<{
        name: string;
        description?: string;
        specialPrice: number;
        productNames: string[];
      }>;
    },
  ) {
    const { userId, clientId, products, promotions } = body;

    // 1. Procesar productos
    for (const product of products) {
      const existing = await this.productRepository.findByUserIdAndName(
        userId,
        product.name,
      );

      const upserted = await this.productRepository.upsertByName(
        userId,
        product.name,
        {
          basePrice: existing
            ? Math.max(existing.basePrice, product.price)
            : product.price,
          description: product.description,
        },
      );

      // Si precio nuevo < base existente → descuento para este cliente
      if (
        existing &&
        product.price < existing.basePrice &&
        clientId
      ) {
        await this.discountRepository.upsert({
          productId: upserted.id,
          clientId,
          discountPrice: product.price,
        });
      }
    }

    // 2. Procesar promociones
    for (const promo of promotions) {
      const productIds: string[] = [];
      for (const productName of promo.productNames) {
        const product = await this.productRepository.upsertByName(
          userId,
          productName,
          { basePrice: 0 },
        );
        productIds.push(product.id);
      }

      const createdPromo = await this.promotionRepository.create({
        userId,
        name: promo.name,
        description: promo.description,
        specialPrice: promo.specialPrice,
        productIds,
      });

      if (clientId) {
        await this.promotionDiscountRepository.upsert({
          promotionId: createdPromo.id,
          clientId,
          discountPrice: promo.specialPrice,
        });
      }
    }

    return { processed: { products: products.length, promotions: promotions.length } };
  }
}
