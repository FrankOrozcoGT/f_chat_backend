import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ShippingLocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string) {
    return this.prisma.shippingLocation.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async findByUserIdAndName(userId: string, name: string) {
    return this.prisma.shippingLocation.findUnique({
      where: { userId_name: { userId, name } },
    });
  }

  async upsert(
    userId: string,
    name: string,
    data: { isFreeShipping: boolean; shippingCost: number },
  ) {
    return this.prisma.shippingLocation.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name, ...data },
      update: data,
    });
  }
}
