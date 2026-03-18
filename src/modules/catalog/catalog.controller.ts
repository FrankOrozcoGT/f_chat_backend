import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
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

interface AuthUser {
  id: string;
  tenantId: string;
}

@Controller('api/catalog')
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly shippingLocationRepository: ShippingLocationRepository,
    private readonly discountRepository: DiscountRepository,
  ) {}

  // ─── Products ────────────────────────────────────────────────────────────────

  @Get('products')
  getProducts(@CurrentUser() user: AuthUser) {
    return this.productRepository.findByTenantId(user.tenantId);
  }

  @Post('products')
  createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.productRepository.create(user.tenantId, dto);
  }

  @Put('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productRepository.updateById(id, dto);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.productRepository.deleteById(id);
  }

  // ─── Discounts ───────────────────────────────────────────────────────────────

  @Get('products/:productId/discounts')
  getDiscounts(@Param('productId') productId: string) {
    return this.discountRepository.findByProductId(productId);
  }

  @Post('products/:productId/discounts')
  createDiscount(@Param('productId') productId: string, @Body() dto: CreateDiscountDto) {
    return this.discountRepository.upsert({
      productId,
      clientId: dto.clientId ?? null,
      discountPrice: dto.discountPrice,
    });
  }

  @Delete('discounts/:id')
  deleteDiscount(@Param('id') id: string) {
    return this.discountRepository.deleteById(id);
  }

  // ─── Promotions ──────────────────────────────────────────────────────────────

  @Get('promotions')
  getPromotions(@CurrentUser() user: AuthUser) {
    return this.promotionRepository.findByTenantId(user.tenantId);
  }

  @Post('promotions')
  createPromotion(@CurrentUser() user: AuthUser, @Body() dto: CreatePromotionDto) {
    return this.promotionRepository.create({ tenantId: user.tenantId, ...dto });
  }

  @Put('promotions/:id')
  updatePromotion(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotionRepository.updateById(id, dto);
  }

  @Delete('promotions/:id')
  deletePromotion(@Param('id') id: string) {
    return this.promotionRepository.deleteById(id);
  }

  // ─── Shipping Locations ───────────────────────────────────────────────────────

  @Get('shipping-locations')
  getShippingLocations(@CurrentUser() user: AuthUser) {
    return this.shippingLocationRepository.findByTenantId(user.tenantId);
  }

  @Post('shipping-locations')
  createShippingLocation(@CurrentUser() user: AuthUser, @Body() dto: CreateShippingLocationDto) {
    return this.shippingLocationRepository.create(user.tenantId, dto);
  }

  @Put('shipping-locations/:id')
  updateShippingLocation(@Param('id') id: string, @Body() dto: UpdateShippingLocationDto) {
    return this.shippingLocationRepository.updateById(id, dto);
  }

  @Delete('shipping-locations/:id')
  deleteShippingLocation(@Param('id') id: string) {
    return this.shippingLocationRepository.deleteById(id);
  }
}
