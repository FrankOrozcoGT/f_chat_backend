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
import { ShippingLocationRepository } from './repositories/shipping-location.repository';
import { TenantSettingsRepository } from '../tenant-settings/repositories/tenant-settings.repository';
import { PrismaService } from '@common/prisma/prisma.service';

@Controller('internal/catalog')
@UseGuards(InternalGuard)
export class InternalCatalogController {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly discountRepository: DiscountRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly promotionDiscountRepository: PromotionDiscountRepository,
    private readonly shippingLocationRepository: ShippingLocationRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly prisma: PrismaService,
  ) {}

  @Post('products/upsert')
  async upsertProduct(
    @Body() body: { tenantId: string; name: string; basePrice: number; description?: string },
  ) {
    return this.productRepository.upsertByName(body.tenantId, body.name, {
      basePrice: body.basePrice,
      description: body.description,
    });
  }

  @Post('products/find')
  async findProduct(
    @Body() body: { tenantId: string; name: string },
  ) {
    return this.productRepository.findByTenantIdAndName(body.tenantId, body.name);
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
      tenantId: string;
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

  // --- Endpoints para funciones del nodo Identificación+Precio ---

  /**
   * loadClientProducts (preCode): productos del tenant con descuentos del cliente + promos.
   */
  @Post('load-client-products')
  async loadClientProducts(
    @Body() body: { tenantId: string; clientId: string | null },
  ) {
    const products = await this.productRepository.findByTenantId(body.tenantId);

    // Filtrar descuentos: solo los del cliente o los genéricos (sin clientId)
    const productsWithRelevantDiscounts = products.map((p) => ({
      id: p.id,
      name: p.name,
      basePrice: p.basePrice,
      description: p.description,
      discounts: p.discounts.filter(
        (d) => d.clientId === body.clientId || d.clientId === null,
      ),
    }));

    // Promos: por cliente si hay clientId, sino generales del tenant
    const promotions = body.clientId
      ? await this.promotionRepository.findByClientId(body.clientId)
      : await this.promotionRepository.findByTenantId(body.tenantId);

    // Shipping: ubicación del cliente + zonas de envío del tenant + default
    const clientLocation = body.clientId
      ? (await this.prisma.client.findUnique({ where: { id: body.clientId }, select: { location: true } }))?.location ?? null
      : null;

    const shippingLocations = await this.shippingLocationRepository.findByTenantId(body.tenantId);

    const settings = await this.tenantSettingsRepository.findByTenantId(body.tenantId);
    const defaultShippingCost = settings?.defaultShippingCost ?? 0;

    return {
      products: productsWithRelevantDiscounts,
      promotions,
      shipping: {
        clientLocation,
        locations: shippingLocations,
        defaultShippingCost,
      },
    };
  }

  /**
   * searchProduct (tool): busca producto por nombre/descripción.
   */
  @Post('search-product')
  async searchProduct(
    @Body() body: { tenantId: string; query: string },
  ) {
    const products = await this.productRepository.findByTenantId(body.tenantId);
    const queryLower = body.query.toLowerCase();
    const matches = products.filter(
      (p) =>
        p.name.toLowerCase().includes(queryLower) ||
        (p.description && p.description.toLowerCase().includes(queryLower)),
    );
    return { matches };
  }

  /**
   * checkPromotions (tool): promos aplicables a un producto.
   */
  @Post('check-promotions')
  async checkPromotions(
    @Body() body: { tenantId: string; clientId: string | null; productName: string },
  ) {
    const promotions = body.clientId
      ? await this.promotionRepository.findByClientId(body.clientId)
      : await this.promotionRepository.findByTenantId(body.tenantId);

    const applicable = promotions.filter((promo) =>
      promo.promotionProducts.some(
        (pp) => pp.product.name.toLowerCase() === body.productName.toLowerCase(),
      ),
    );
    return { promotions: applicable };
  }

  /**
   * registerMissingProduct (postCode): registra producto faltante.
   */
  @Post('register-missing-product')
  async registerMissingProduct(
    @Body() body: { tenantId: string; productName: string; clientId: string | null; notes: string },
  ) {
    // Crear producto con precio 0 como placeholder
    const product = await this.productRepository.upsertByName(body.tenantId, body.productName, {
      basePrice: 0,
      description: `[PENDIENTE DE PRECIO] ${body.notes}`,
    });
    return { product, registered: true };
  }

  /**
   * calculateSale (tool): calcula subtotal + envío + total.
   * Envío: 1. Match en ShippingLocation → 2. defaultShippingCost → 3. gratis
   */
  @Post('calculate-sale')
  async calculateSale(
    @Body() body: { tenantId: string; items: Array<{ productName: string; unitPrice: number; quantity: number }>; location: string },
  ) {
    const subtotal = body.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    const shippingLocation = await this.shippingLocationRepository.findByTenantIdAndName(
      body.tenantId,
      body.location,
    );

    let shippingCost: number;
    if (shippingLocation) {
      shippingCost = shippingLocation.isFreeShipping ? 0 : shippingLocation.shippingCost;
    } else {
      const settings = await this.tenantSettingsRepository.findByTenantId(body.tenantId);
      shippingCost = settings?.defaultShippingCost ?? 0;
    }

    const total = subtotal + shippingCost;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      shippingCost: Math.round(shippingCost * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
  }

  /**
   * saveClientLocation (tool): guarda la ubicación del cliente.
   */
  @Post('save-client-location')
  async saveClientLocation(
    @Body() body: { clientId: string; location: string },
  ) {
    const client = await this.prisma.client.update({
      where: { id: body.clientId },
      data: { location: body.location },
    });
    return { clientId: client.id, location: client.location };
  }

  /**
   * Procesa productos y promociones extraídos del análisis de conversación.
   * Lógica de precio: si el precio nuevo es menor al base existente → crea descuento para el cliente.
   */
  @Post('process-analysis-catalog')
  async processAnalysisCatalog(
    @Body()
    body: {
      tenantId: string;
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
    const { tenantId, clientId, products, promotions } = body;

    // 1. Procesar productos
    for (const product of products) {
      const existing = await this.productRepository.findByTenantIdAndName(
        tenantId,
        product.name,
      );

      const upserted = await this.productRepository.upsertByName(
        tenantId,
        product.name,
        {
          basePrice: existing
            ? Math.max(existing.basePrice, product.price ?? 0)
            : (product.price ?? 0),
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
          tenantId,
          productName,
          { basePrice: 0 },
        );
        if (!productIds.includes(product.id)) productIds.push(product.id);
      }

      const createdPromo = await this.promotionRepository.upsertByName({
        tenantId,
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
