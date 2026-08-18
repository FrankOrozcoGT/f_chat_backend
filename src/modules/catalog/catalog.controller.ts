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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
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
  constructor(private readonly catalogService: CatalogService) {}

  // ─── Products ────────────────────────────────────────────────────────────────

  @Get('products')
  async getProducts(@CurrentUser() user: AuthUser) {
    return this.catalogService.getProducts(user.tenantId);
  }

  @Post('products')
  createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.catalogService.createProduct(user.tenantId, dto);
  }

  @Put('products/:id')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(user.tenantId, id, dto);
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
    return this.catalogService.uploadProductImage(user.tenantId, id, file);
  }

  @Delete('products/:id')
  deleteProduct(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalogService.deleteProduct(user.tenantId, id);
  }

  // ─── Discounts ───────────────────────────────────────────────────────────────

  @Get('products/:productId/discounts')
  async getDiscounts(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.catalogService.getDiscounts(user.tenantId, productId);
  }

  @Post('products/:productId/discounts')
  async createDiscount(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() dto: CreateDiscountDto,
  ) {
    return this.catalogService.createDiscount(user.tenantId, productId, dto);
  }

  @Delete('discounts/:id')
  deleteDiscount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalogService.deleteDiscount(user.tenantId, id);
  }

  // ─── Promotions ──────────────────────────────────────────────────────────────

  @Get('promotions')
  getPromotions(@CurrentUser() user: AuthUser) {
    return this.catalogService.getPromotions(user.tenantId);
  }

  @Post('promotions')
  createPromotion(@CurrentUser() user: AuthUser, @Body() dto: CreatePromotionDto) {
    return this.catalogService.createPromotion(user.tenantId, dto);
  }

  @Put('promotions/:id')
  updatePromotion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.catalogService.updatePromotion(user.tenantId, id, dto);
  }

  @Delete('promotions/:id')
  deletePromotion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalogService.deletePromotion(user.tenantId, id);
  }

  // ─── Shipping Locations ───────────────────────────────────────────────────────

  @Get('shipping-locations')
  getShippingLocations(@CurrentUser() user: AuthUser) {
    return this.catalogService.getShippingLocations(user.tenantId);
  }

  @Post('shipping-locations')
  createShippingLocation(@CurrentUser() user: AuthUser, @Body() dto: CreateShippingLocationDto) {
    return this.catalogService.createShippingLocation(user.tenantId, dto);
  }

  @Put('shipping-locations/:id')
  updateShippingLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateShippingLocationDto,
  ) {
    return this.catalogService.updateShippingLocation(user.tenantId, id, dto);
  }

  @Delete('shipping-locations/:id')
  deleteShippingLocation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalogService.deleteShippingLocation(user.tenantId, id);
  }
}
