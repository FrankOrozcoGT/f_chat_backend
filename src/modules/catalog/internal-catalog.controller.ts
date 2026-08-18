import {
  Controller,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { InternalCatalogService } from './internal-catalog.service';

@Controller('internal/catalog')
@UseGuards(InternalGuard)
export class InternalCatalogController {
  constructor(private readonly internalCatalogService: InternalCatalogService) {}

  @Post('products/upsert')
  async upsertProduct(
    @Body() body: { tenantId: string; name: string; basePrice: number; description?: string },
  ) {
    return this.internalCatalogService.upsertProduct(body.tenantId, body.name, body.basePrice, body.description);
  }

  @Post('products/find')
  async findProduct(
    @Body() body: { tenantId: string; name: string },
  ) {
    return this.internalCatalogService.findProduct(body.tenantId, body.name);
  }

  @Post('discounts/upsert')
  async upsertDiscount(
    @Body() body: { productId: string; clientId?: string | null; discountPrice: number },
  ) {
    return this.internalCatalogService.upsertDiscount(body);
  }

  @Post('promotions/create')
  async createPromotion(
    @Body() body: {
      tenantId: string;
      name?: string;
      description?: string;
      specialPrice: number;
      productIds: string[];
    },
  ) {
    return this.internalCatalogService.createPromotion(body);
  }

  @Post('promotion-discounts/upsert')
  async upsertPromotionDiscount(
    @Body() body: { promotionId: string; clientId?: string | null; discountPrice: number },
  ) {
    return this.internalCatalogService.upsertPromotionDiscount(body);
  }

  @Post('load-client-products')
  async loadClientProducts(
    @Body() body: { tenantId: string; clientId: string | null },
  ) {
    return this.internalCatalogService.loadClientProducts(body.tenantId, body.clientId);
  }

  @Post('search-product')
  async searchProduct(
    @Body() body: { tenantId: string; query: string },
  ) {
    return this.internalCatalogService.searchProduct(body.tenantId, body.query);
  }

  @Post('check-promotions')
  async checkPromotions(
    @Body() body: { tenantId: string; clientId: string | null; productName: string },
  ) {
    return this.internalCatalogService.checkPromotions(body.tenantId, body.clientId, body.productName);
  }

  @Post('register-missing-product')
  async registerMissingProduct(
    @Body() body: { tenantId: string; productName: string; clientId: string | null; notes: string },
  ) {
    return this.internalCatalogService.registerMissingProduct(body.tenantId, body.productName, body.notes);
  }

  @Post('calculate-sale')
  async calculateSale(
    @Body() body: { tenantId: string; items: Array<{ productName: string; unitPrice: number; quantity: number }>; location: string },
  ) {
    return this.internalCatalogService.calculateSale(body.tenantId, body.items, body.location);
  }

  @Post('save-client-location')
  async saveClientLocation(
    @Body() body: { clientId: string; location: string },
  ) {
    return this.internalCatalogService.saveClientLocation(body.clientId, body.location);
  }

  /**
   * Procesa productos y promociones extraídos del análisis de conversación.
   */
  @Post('process-analysis-catalog')
  async processAnalysisCatalog(
    @Body()
    body: {
      tenantId: string;
      clientId: string | null;
      products: Array<{ name: string; price: number; description?: string }>;
      promotions: Array<{ name: string; description?: string; specialPrice: number; productNames: string[] }>;
    },
  ) {
    return this.internalCatalogService.processAnalysisCatalog(
      body.tenantId,
      body.clientId,
      body.products,
      body.promotions,
    );
  }
}
