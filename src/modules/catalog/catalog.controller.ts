import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { R2Service } from '@common/r2/r2.service';
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
    private readonly r2Service: R2Service,
  ) {}

  // ─── Products ────────────────────────────────────────────────────────────────

  @Get('products')
  async getProducts(@CurrentUser() user: AuthUser) {
    const products = await this.productRepository.findByTenantId(user.tenantId);
    return products.map((p) => ({
      ...p,
      imageUrl: p.imageKey ? this.r2Service.buildUrl(p.imageKey) : null,
    }));
  }

  @Post('products')
  createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.productRepository.create(user.tenantId, dto);
  }

  @Put('products/:id')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productRepository.updateById(id, user.tenantId, dto);
  }

  @Put('products/:id/image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
      fileFilter: (_req: Request, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only image files (jpeg, png, gif, webp) are allowed'), false);
        }
      },
    }),
  )
  async uploadProductImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    if (!file) throw new BadRequestException('image file is required');

    const product = await this.productRepository.findById(id, user.tenantId);
    if (!product) throw new NotFoundException('product not found');

    if (product.imageKey) {
      await this.r2Service.deleteImage(product.imageKey);
    }

    const key = await this.r2Service.uploadImage('products', id, file.buffer, file.mimetype);
    await this.productRepository.updateImageKey(id, user.tenantId, key);

    return { imageUrl: this.r2Service.buildUrl(key) };
  }

  @Delete('products/:id')
  deleteProduct(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.productRepository.deleteById(id, user.tenantId);
  }

  // ─── Discounts ───────────────────────────────────────────────────────────────

  @Get('products/:productId/discounts')
  async getDiscounts(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    const product = await this.productRepository.findById(productId, user.tenantId);
    if (!product) throw new NotFoundException('product not found');
    return this.discountRepository.findByProductId(productId);
  }

  @Post('products/:productId/discounts')
  async createDiscount(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() dto: CreateDiscountDto,
  ) {
    const product = await this.productRepository.findById(productId, user.tenantId);
    if (!product) throw new NotFoundException('product not found');

    return this.discountRepository.upsert({
      productId,
      clientId: dto.clientId ?? null,
      discountPrice: dto.discountPrice,
    });
  }

  @Delete('discounts/:id')
  deleteDiscount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.discountRepository.deleteById(id, user.tenantId);
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
  updatePromotion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.promotionRepository.updateById(id, user.tenantId, dto);
  }

  @Delete('promotions/:id')
  deletePromotion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.promotionRepository.deleteById(id, user.tenantId);
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
  updateShippingLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateShippingLocationDto,
  ) {
    return this.shippingLocationRepository.updateById(id, user.tenantId, dto);
  }

  @Delete('shipping-locations/:id')
  deleteShippingLocation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shippingLocationRepository.deleteById(id, user.tenantId);
  }
}
