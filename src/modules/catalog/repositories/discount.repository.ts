import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class DiscountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProductId(productId: string) {
    return this.prisma.discount.findMany({
      where: { productId },
      include: { client: true },
      orderBy: { discountPrice: 'asc' },
    });
  }

  async findByProductAndClient(productId: string, clientId: string) {
    return this.prisma.discount.findMany({
      where: { productId, clientId },
    });
  }

  async findByClientId(clientId: string) {
    return this.prisma.discount.findMany({
      where: { clientId },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsert(data: {
    productId: string;
    clientId?: string | null;
    discountPrice: number;
  }) {
    return this.prisma.discount.upsert({
      where: {
        productId_discountPrice: {
          productId: data.productId,
          discountPrice: data.discountPrice,
        },
      },
      create: {
        productId: data.productId,
        clientId: data.clientId ?? null,
        discountPrice: data.discountPrice,
      },
      update: {
        clientId: data.clientId ?? null,
      },
    });
  }
}
