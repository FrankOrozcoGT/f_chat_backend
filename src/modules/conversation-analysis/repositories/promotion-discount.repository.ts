import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class PromotionDiscountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByPromotionId(promotionId: string) {
    return this.prisma.promotionDiscount.findMany({
      where: { promotionId },
      include: { client: true },
      orderBy: { discountPrice: 'asc' },
    });
  }

  async findByPromotionAndClient(promotionId: string, clientId: string) {
    return this.prisma.promotionDiscount.findMany({
      where: { promotionId, clientId },
    });
  }

  async findByClientId(clientId: string) {
    return this.prisma.promotionDiscount.findMany({
      where: { clientId },
      include: { promotion: { include: { promotionProducts: { include: { product: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsert(data: {
    promotionId: string;
    clientId?: string | null;
    discountPrice: number;
  }) {
    return this.prisma.promotionDiscount.upsert({
      where: {
        promotionId_discountPrice: {
          promotionId: data.promotionId,
          discountPrice: data.discountPrice,
        },
      },
      create: {
        promotionId: data.promotionId,
        clientId: data.clientId ?? null,
        discountPrice: data.discountPrice,
      },
      update: {
        clientId: data.clientId ?? null,
      },
    });
  }
}
