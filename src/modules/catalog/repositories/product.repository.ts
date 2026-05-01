import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId },
      include: { discounts: true },
      orderBy: { name: 'asc' },
    });
  }

  async findByTenantIdAndName(tenantId: string, name: string) {
    return this.prisma.product.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
  }

  async upsertByName(
    tenantId: string,
    name: string,
    data: { basePrice: number; description?: string },
  ) {
    return this.prisma.product.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: {
        tenantId,
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

  async create(tenantId: string, data: { name: string; basePrice: number; description?: string }) {
    return this.prisma.product.create({
      data: { tenantId, ...data },
    });
  }

  async updateById(id: string, data: { name?: string; basePrice?: number; description?: string }) {
    return this.prisma.product.update({
      where: { id },
      data,
    });
  }

  async updateImageKey(id: string, imageKey: string | null) {
    return this.prisma.product.update({
      where: { id },
      data: { imageKey },
    });
  }

  async findById(id: string) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  async deleteById(id: string) {
    return this.prisma.product.delete({ where: { id } });
  }
}
