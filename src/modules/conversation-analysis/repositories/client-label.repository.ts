import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ClientLabelRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertDraftLabel(data: {
    tenantId: string;
    clientId: string | null;
    groupJid: string | null;
    internalPurpose: string;
    channelName: string;
  }) {
    return this.prisma.contactLabel.upsert({
      where: { tenantId_label: { tenantId: data.tenantId, label: data.channelName } },
      create: {
        tenantId: data.tenantId,
        label: data.channelName,
        clientId: data.clientId,
        groupJid: data.groupJid,
        status: 'draft',
      },
      update: {
        clientId: data.clientId,
        groupJid: data.groupJid,
        status: 'draft',
      },
    });
  }

  async findInternalByClientOrGroup(data: {
    tenantId: string;
    clientId: string | null;
    groupJid: string | null;
  }): Promise<{ label: string } | null> {
    if (!data.clientId && !data.groupJid) return null;
    const conditions: Prisma.ContactLabelWhereInput[] = [];
    if (data.clientId) conditions.push({ clientId: data.clientId });
    if (data.groupJid) conditions.push({ groupJid: data.groupJid });
    return this.prisma.contactLabel.findFirst({
      where: { tenantId: data.tenantId, status: { in: ['draft', 'active'] }, OR: conditions },
      select: { label: true },
    });
  }
}
