import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class IntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    return this.prisma.intent.findMany({
      where: {
        tenantId,
        OR: [{ flowId: null }, { flow: { status: 'active' } }],
      },
      include: { flow: true },
    });
  }

  async findByTenantIdAndName(tenantId: string, name: string) {
    return this.prisma.intent.findUnique({
      where: { tenantId_name: { tenantId, name } },
      include: { flow: true },
    });
  }

  async upsert(tenantId: string, name: string, flowId?: string) {
    return this.prisma.intent.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name, flowId },
      update: { flowId },
    });
  }

  async create(tenantId: string, data: { name: string; flowId?: string }) {
    return this.prisma.intent.create({
      data: { tenantId, ...data },
      include: { flow: true },
    });
  }

  async updateById(id: string, tenantId: string, data: { name?: string; flowId?: string }) {
    const intent = await this.prisma.intent.findFirst({ where: { id, tenantId } });
    if (!intent) return null;
    return this.prisma.intent.update({ where: { id }, data, include: { flow: true } });
  }

  async deleteById(id: string, tenantId: string) {
    const result = await this.prisma.intent.deleteMany({ where: { id, tenantId } });
    return result;
  }

  async delete(tenantId: string, name: string) {
    return this.prisma.intent.delete({
      where: { tenantId_name: { tenantId, name } },
    });
  }

  async findByFlowId(flowId: string) {
    return this.prisma.intent.findFirst({
      where: { flowId },
    });
  }

  async findActiveByTenantId(tenantId: string) {
    return this.prisma.intent.findMany({
      where: { tenantId, isActive: true, flowId: { not: null } },
      include: { flow: { include: { nodes: { include: { node: true } }, transitions: true } } },
    });
  }
}
