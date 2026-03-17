import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ContactLabelRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    return this.prisma.contactLabel.findMany({
      where: { tenantId },
      include: { client: true },
    });
  }

  async findByTenantIdAndLabel(tenantId: string, label: string) {
    return this.prisma.contactLabel.findUnique({
      where: { tenantId_label: { tenantId, label } },
      include: { client: true },
    });
  }

  async findByClientPhone(phoneNumber: string) {
    return this.prisma.contactLabel.findMany({
      where: { client: { phoneNumber } },
      include: { client: true },
    });
  }

  async upsert(tenantId: string, label: string, data: { clientId?: string; groupJid?: string }) {
    return this.prisma.contactLabel.upsert({
      where: { tenantId_label: { tenantId, label } },
      create: { tenantId, label, ...data },
      update: data,
      include: { client: true },
    });
  }
}
