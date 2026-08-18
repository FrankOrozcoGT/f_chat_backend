import { Injectable, NotFoundException } from '@nestjs/common';
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

  async updateById(
    id: string,
    tenantId: string,
    data: { name?: string; basePrice?: number; description?: string },
  ) {
    const { count } = await this.prisma.product.updateMany({
      where: { id, tenantId },
      data,
    });
    if (count === 0) throw new NotFoundException('Product not found');
    return this.findById(id, tenantId);
  }

  async updateImageKey(id: string, tenantId: string, imageKey: string | null) {
    const { count } = await this.prisma.product.updateMany({
      where: { id, tenantId },
      data: { imageKey },
    });
    if (count === 0) throw new NotFoundException('Product not found');
  }

  async findById(id: string, tenantId: string) {
    return this.prisma.product.findFirst({ where: { id, tenantId } });
  }

  async deleteById(id: string, tenantId: string) {
    const { count } = await this.prisma.product.deleteMany({
      where: { id, tenantId },
    });
    if (count === 0) throw new NotFoundException('Product not found');
  }
}
