import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { InternalCatalogController } from './internal-catalog.controller';
import { ProductRepository } from './repositories/product.repository';
import { DiscountRepository } from './repositories/discount.repository';
import { PromotionRepository } from './repositories/promotion.repository';
import { PromotionDiscountRepository } from './repositories/promotion-discount.repository';
import { ShippingLocationRepository } from './repositories/shipping-location.repository';
import { TenantSettingsRepository } from '../tenant-settings/repositories/tenant-settings.repository';

@Module({
  imports: [PrismaModule],
  controllers: [InternalCatalogController],
  providers: [
    ProductRepository,
    DiscountRepository,
    PromotionRepository,
    PromotionDiscountRepository,
    ShippingLocationRepository,
    TenantSettingsRepository,
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
