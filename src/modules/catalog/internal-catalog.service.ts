import { Injectable } from '@nestjs/common';
import { ProductRepository } from './repositories/product.repository';
import { DiscountRepository } from './repositories/discount.repository';
import { PromotionRepository } from './repositories/promotion.repository';
import { PromotionDiscountRepository } from './repositories/promotion-discount.repository';
import { ShippingLocationRepository } from './repositories/shipping-location.repository';
import { TenantSettingsRepository } from '../tenant-settings/repositories/tenant-settings.repository';
import { ClientRepository } from './repositories/client.repository';
import { R2Service } from '@common/r2/r2.service';

interface AnalysisProduct {
  name: string;
  price: number;
  description?: string;
}

interface AnalysisPromotion {
  name: string;
  description?: string;
  specialPrice: number;
  productNames: string[];
}

@Injectable()
export class InternalCatalogService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly discountRepository: DiscountRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly promotionDiscountRepository: PromotionDiscountRepository,
    private readonly shippingLocationRepository: ShippingLocationRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly clientRepository: ClientRepository,
    private readonly r2Service: R2Service,
  ) {}

  async upsertProduct(tenantId: string, name: string, basePrice: number, description?: string) {
    return this.productRepository.upsertByName(tenantId, name, { basePrice, description });
  }

  async findProduct(tenantId: string, name: string) {
    return this.productRepository.findByTenantIdAndName(tenantId, name);
  }

  async upsertDiscount(data: { productId: string; clientId?: string | null; discountPrice: number }) {
    return this.discountRepository.upsert(data);
  }

  async createPromotion(data: {
    tenantId: string;
    name?: string;
    description?: string;
    specialPrice: number;
    productIds: string[];
  }) {
    return this.promotionRepository.create(data);
  }

  async upsertPromotionDiscount(data: { promotionId: string; clientId?: string | null; discountPrice: number }) {
    return this.promotionDiscountRepository.upsert(data);
  }

  /**
   * loadClientProducts (preCode): productos del tenant con descuentos del cliente + promos.
   */
  async loadClientProducts(tenantId: string, clientId: string | null) {
    const products = await this.productRepository.findByTenantId(tenantId);

    // Filtrar descuentos: solo los del cliente o los genéricos (sin clientId)
    const productsWithRelevantDiscounts = products.map((p) => ({
      id: p.id,
      name: p.name,
      basePrice: p.basePrice,
      description: p.description,
      imageUrl: p.imageKey ? this.r2Service.buildUrl(p.imageKey) : null,
      discounts: p.discounts.filter(
        (d) => d.clientId === clientId || d.clientId === null,
      ),
    }));

    // Promos: por cliente si hay clientId, sino generales del tenant
    const promotions = clientId
      ? await this.promotionRepository.findByClientId(clientId)
      : await this.promotionRepository.findByTenantId(tenantId);

    // Shipping: ubicación del cliente + zonas de envío del tenant + default
    const clientLocation = clientId
      ? (await this.clientRepository.findLocationById(clientId))?.location ?? null
      : null;

    const shippingLocations = await this.shippingLocationRepository.findByTenantId(tenantId);

    const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
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
  async searchProduct(tenantId: string, query: string) {
    const products = await this.productRepository.findByTenantId(tenantId);
    const queryLower = query.toLowerCase();
    const matches = products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(queryLower) ||
          (p.description && p.description.toLowerCase().includes(queryLower)),
      )
      .map((p) => ({
        ...p,
        imageUrl: p.imageKey ? this.r2Service.buildUrl(p.imageKey) : null,
      }));
    return { matches };
  }

  /**
   * checkPromotions (tool): promos aplicables a un producto.
   */
  async checkPromotions(tenantId: string, clientId: string | null, productName: string) {
    const promotions = clientId
      ? await this.promotionRepository.findByClientId(clientId)
      : await this.promotionRepository.findByTenantId(tenantId);

    const applicable = promotions.filter((promo) =>
      promo.promotionProducts.some(
        (pp) => pp.product.name.toLowerCase() === productName.toLowerCase(),
      ),
    );
    return { promotions: applicable };
  }

  /**
   * registerMissingProduct (postCode): registra producto faltante.
   */
  async registerMissingProduct(tenantId: string, productName: string, notes: string) {
    // Crear producto con precio 0 como placeholder
    const product = await this.productRepository.upsertByName(tenantId, productName, {
      basePrice: 0,
      description: `[PENDIENTE DE PRECIO] ${notes}`,
    });
    return { product, registered: true };
  }

  /**
   * calculateSale (tool): calcula subtotal + envío + total.
   * Envío: 1. Match en ShippingLocation → 2. defaultShippingCost → 3. gratis
   */
  async calculateSale(
    tenantId: string,
    items: Array<{ productName: string; unitPrice: number; quantity: number }>,
    location: string,
  ) {
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    const shippingLocation = await this.shippingLocationRepository.findByTenantIdAndName(
      tenantId,
      location,
    );

    let shippingCost: number;
    if (shippingLocation) {
      shippingCost = shippingLocation.isFreeShipping ? 0 : shippingLocation.shippingCost;
    } else {
      const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
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
  async saveClientLocation(clientId: string, location: string) {
    const client = await this.clientRepository.updateLocation(clientId, location);
    return { clientId: client.id, location: client.location };
  }

  /**
   * Procesa productos y promociones extraídos del análisis de conversación.
   * Lógica de precio: si el precio nuevo es menor al base existente → crea descuento para el cliente.
   */
  async processAnalysisCatalog(
    tenantId: string,
    clientId: string | null,
    products: AnalysisProduct[],
    promotions: AnalysisPromotion[],
  ) {
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
