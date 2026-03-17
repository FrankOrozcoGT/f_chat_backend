import { Injectable } from '@nestjs/common';
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
}
