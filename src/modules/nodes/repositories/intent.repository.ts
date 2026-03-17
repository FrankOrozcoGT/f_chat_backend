import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class IntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    return this.prisma.intent.findMany({
      where: { tenantId },
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

  async delete(tenantId: string, name: string) {
    return this.prisma.intent.delete({
      where: { tenantId_name: { tenantId, name } },
    });
  }
}
