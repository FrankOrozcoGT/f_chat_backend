import { Injectable, NotFoundException } from '@nestjs/common';
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

  async updateById(
    id: string,
    tenantId: string,
    data: { name?: string; description?: string; specialPrice?: number; productIds?: string[] },
  ) {
    const owned = await this.prisma.promotion.findFirst({ where: { id, tenantId } });
    if (!owned) throw new NotFoundException('Promotion not found');

    const { productIds, ...fields } = data;
    return this.prisma.promotion.update({
      where: { id },
      data: {
        ...fields,
        ...(productIds && {
          promotionProducts: {
            deleteMany: {},
            create: productIds.map((productId) => ({ productId })),
          },
        }),
      },
      include: { promotionProducts: { include: { product: true } } },
    });
  }

  async deleteById(id: string, tenantId: string) {
    const { count } = await this.prisma.promotion.deleteMany({
      where: { id, tenantId },
    });
    if (count === 0) throw new NotFoundException('Promotion not found');
  }

  async upsertByName(data: {
    tenantId: string;
    name: string;
    description?: string;
    specialPrice: number;
    productIds: string[];
  }) {
    const existing = await this.prisma.promotion.findFirst({
      where: { tenantId: data.tenantId, name: data.name },
    });

    if (existing) {
      return this.updateById(existing.id, data.tenantId, {
        description: data.description,
        specialPrice: data.specialPrice,
        productIds: data.productIds,
      });
    }

    return this.create(data);
  }
}
