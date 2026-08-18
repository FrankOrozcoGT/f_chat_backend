import { Injectable, NotFoundException } from '@nestjs/common';
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
      where: { client: { phoneNumber }, groupJid: null, status: 'active' },
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

  async create(tenantId: string, data: { label: string; clientId?: string; groupJid?: string }) {
    return this.prisma.contactLabel.create({
      data: { tenantId, ...data },
      include: { client: true },
    });
  }

  async updateById(
    id: string,
    tenantId: string,
    data: { label?: string; clientId?: string; groupJid?: string },
  ) {
    const { count } = await this.prisma.contactLabel.updateMany({
      where: { id, tenantId },
      data,
    });
    if (count === 0) throw new NotFoundException('Label not found');
    return this.prisma.contactLabel.findUnique({ where: { id }, include: { client: true } });
  }

  async deleteById(id: string, tenantId: string) {
    const { count } = await this.prisma.contactLabel.deleteMany({
      where: { id, tenantId },
    });
    if (count === 0) throw new NotFoundException('Label not found');
  }
}
