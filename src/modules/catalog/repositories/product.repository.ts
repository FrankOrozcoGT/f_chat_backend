import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string) {
    return this.prisma.product.findMany({
      where: { userId },
      include: { discounts: true },
      orderBy: { name: 'asc' },
    });
  }

  async findByUserIdAndName(userId: string, name: string) {
    return this.prisma.product.findUnique({
      where: { userId_name: { userId, name } },
    });
  }

  async upsertByName(
    userId: string,
    name: string,
    data: { basePrice: number; description?: string },
  ) {
    return this.prisma.product.upsert({
      where: { userId_name: { userId, name } },
      create: {
        userId,
        name,
        basePrice: data.basePrice,
        description: data.description,
      },
      update: {
        basePrice: data.basePrice,
        ...(data.description && { description: data.description }),
      },
    });
  }

  async updateBasePrice(productId: string, basePrice: number) {
    return this.prisma.product.update({
      where: { id: productId },
      data: { basePrice },
    });
  }
}
