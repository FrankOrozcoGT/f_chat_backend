import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ShippingLocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    return this.prisma.shippingLocation.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async findByTenantIdAndName(tenantId: string, name: string) {
    return this.prisma.shippingLocation.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
  }

  async upsert(
    tenantId: string,
    name: string,
    data: { isFreeShipping: boolean; shippingCost: number },
  ) {
    return this.prisma.shippingLocation.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name, ...data },
      update: data,
    });
  }

  async create(tenantId: string, data: { name: string; isFreeShipping: boolean; shippingCost: number }) {
    return this.prisma.shippingLocation.create({
      data: { tenantId, ...data },
    });
  }

  async updateById(
    id: string,
    tenantId: string,
    data: { name?: string; isFreeShipping?: boolean; shippingCost?: number },
  ) {
    const { count } = await this.prisma.shippingLocation.updateMany({
      where: { id, tenantId },
      data,
    });
    if (count === 0) throw new NotFoundException('Shipping location not found');
  }

  async deleteById(id: string, tenantId: string) {
    const { count } = await this.prisma.shippingLocation.deleteMany({
      where: { id, tenantId },
    });
    if (count === 0) throw new NotFoundException('Shipping location not found');
  }
}
