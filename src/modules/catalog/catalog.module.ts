import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { InternalCatalogController } from './internal-catalog.controller';
import { ProductRepository } from './repositories/product.repository';
import { DiscountRepository } from './repositories/discount.repository';
import { PromotionRepository } from './repositories/promotion.repository';
import { PromotionDiscountRepository } from './repositories/promotion-discount.repository';
import { ShippingLocationRepository } from './repositories/shipping-location.repository';
import { UserSettingsModule } from '../user-settings/user-settings.module';

@Module({
  imports: [PrismaModule, UserSettingsModule],
  controllers: [InternalCatalogController],
  providers: [
    ProductRepository,
    DiscountRepository,
    PromotionRepository,
    PromotionDiscountRepository,
    ShippingLocationRepository,
  ],
  exports: [
    ProductRepository,
    DiscountRepository,
    PromotionRepository,
    PromotionDiscountRepository,
    ShippingLocationRepository,
  ],
})
export class CatalogModule {}
