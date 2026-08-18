import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { R2Service } from '@common/r2/r2.service';
import { ProductRepository } from './repositories/product.repository';
import { PromotionRepository } from './repositories/promotion.repository';
import { ShippingLocationRepository } from './repositories/shipping-location.repository';
import { DiscountRepository } from './repositories/discount.repository';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { CreateShippingLocationDto } from './dto/create-shipping-location.dto';
import { UpdateShippingLocationDto } from './dto/update-shipping-location.dto';
import { CreateDiscountDto } from './dto/create-discount.dto';

@Injectable()
export class CatalogService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly shippingLocationRepository: ShippingLocationRepository,
    private readonly discountRepository: DiscountRepository,
    private readonly r2Service: R2Service,
  ) {}

  // ─── Products ────────────────────────────────────────────────────────────────

  async getProducts(tenantId: string) {
    const products = await this.productRepository.findByTenantId(tenantId);
    return products.map((p) => ({
      ...p,
      imageUrl: p.imageKey ? this.r2Service.buildUrl(p.imageKey) : null,
    }));
  }

  createProduct(tenantId: string, dto: CreateProductDto) {
    return this.productRepository.create(tenantId, dto);
  }

  updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
    return this.productRepository.updateById(id, tenantId, dto);
  }

  async uploadProductImage(
    tenantId: string,
    id: string,
    file: { buffer: Buffer; mimetype: string } | undefined,
  ) {
    if (!file) throw new BadRequestException('image file is required');

    const product = await this.productRepository.findById(id, tenantId);
    if (!product) throw new NotFoundException('product not found');

    if (product.imageKey) {
      await this.r2Service.deleteImage(product.imageKey);
    }

    const key = await this.r2Service.uploadImage('products', id, file.buffer, file.mimetype);
    await this.productRepository.updateImageKey(id, tenantId, key);

    return { imageUrl: this.r2Service.buildUrl(key) };
  }

  deleteProduct(tenantId: string, id: string) {
    return this.productRepository.deleteById(id, tenantId);
  }

  // ─── Discounts ───────────────────────────────────────────────────────────────

  async getDiscounts(tenantId: string, productId: string) {
    const product = await this.productRepository.findById(productId, tenantId);
    if (!product) throw new NotFoundException('product not found');
    return this.discountRepository.findByProductId(productId);
  }

  async createDiscount(tenantId: string, productId: string, dto: CreateDiscountDto) {
    const product = await this.productRepository.findById(productId, tenantId);
    if (!product) throw new NotFoundException('product not found');

    return this.discountRepository.upsert({
      productId,
      clientId: dto.clientId ?? null,
      discountPrice: dto.discountPrice,
    });
  }

  deleteDiscount(tenantId: string, id: string) {
    return this.discountRepository.deleteById(id, tenantId);
  }

  // ─── Promotions ──────────────────────────────────────────────────────────────

  getPromotions(tenantId: string) {
    return this.promotionRepository.findByTenantId(tenantId);
  }

  createPromotion(tenantId: string, dto: CreatePromotionDto) {
    return this.promotionRepository.create({ tenantId, ...dto });
  }

  updatePromotion(tenantId: string, id: string, dto: UpdatePromotionDto) {
    return this.promotionRepository.updateById(id, tenantId, dto);
  }

  deletePromotion(tenantId: string, id: string) {
    return this.promotionRepository.deleteById(id, tenantId);
  }

  // ─── Shipping Locations ───────────────────────────────────────────────────────

  getShippingLocations(tenantId: string) {
    return this.shippingLocationRepository.findByTenantId(tenantId);
  }

  createShippingLocation(tenantId: string, dto: CreateShippingLocationDto) {
    return this.shippingLocationRepository.create(tenantId, dto);
  }

  updateShippingLocation(tenantId: string, id: string, dto: UpdateShippingLocationDto) {
    return this.shippingLocationRepository.updateById(id, tenantId, dto);
  }

  deleteShippingLocation(tenantId: string, id: string) {
    return this.shippingLocationRepository.deleteById(id, tenantId);
  }
}
