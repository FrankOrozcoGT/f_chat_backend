import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ProductRepository } from './repositories/product.repository';
import { DiscountRepository } from './repositories/discount.repository';
import { PromotionRepository } from './repositories/promotion.repository';
import { PromotionDiscountRepository } from './repositories/promotion-discount.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    ProductRepository,
    DiscountRepository,
    PromotionRepository,
    PromotionDiscountRepository,
  ],
  exports: [
    ProductRepository,
    DiscountRepository,
    PromotionRepository,
    PromotionDiscountRepository,
  ],
})
export class ConversationAnalysisModule {}
