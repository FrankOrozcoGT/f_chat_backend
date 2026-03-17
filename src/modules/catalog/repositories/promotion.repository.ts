import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class PromotionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    return this.prisma.promotion.findMany({
      where: { tenantId },
      include: {
        promotionProducts: { include: { product: true } },
        promotionDiscounts: { include: { client: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByClientId(clientId: string) {
    return this.prisma.promotion.findMany({
      where: {
        promotionDiscounts: { some: { clientId } },
      },
      include: {
        promotionProducts: { include: { product: true } },
        promotionDiscounts: { where: { clientId }, include: { client: true } },
      },
    });
  }

  async create(data: {
    tenantId: string;
    name?: string;
    description?: string;
    specialPrice: number;
    productIds: string[];
  }) {
    return this.prisma.promotion.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        description: data.description,
        specialPrice: data.specialPrice,
        promotionProducts: {
          create: data.productIds.map((productId) => ({ productId })),
        },
      },
      include: {
        promotionProducts: { include: { product: true } },
      },
    });
  }
}
