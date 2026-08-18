import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { InternalCatalogController } from './internal-catalog.controller';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ProductRepository } from './repositories/product.repository';
import { DiscountRepository } from './repositories/discount.repository';
import { PromotionRepository } from './repositories/promotion.repository';
import { PromotionDiscountRepository } from './repositories/promotion-discount.repository';
import { ShippingLocationRepository } from './repositories/shipping-location.repository';
import { ClientRepository } from './repositories/client.repository';
import { TenantSettingsRepository } from '../tenant-settings/repositories/tenant-settings.repository';

@Module({
  imports: [PrismaModule],
  controllers: [InternalCatalogController, CatalogController],
  providers: [
    CatalogService,
    ProductRepository,
    DiscountRepository,
    PromotionRepository,
    PromotionDiscountRepository,
    ShippingLocationRepository,
    ClientRepository,
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
