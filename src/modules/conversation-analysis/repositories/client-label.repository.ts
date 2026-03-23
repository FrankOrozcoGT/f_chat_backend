import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ClientLabelRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertDraftLabel(data: {
    tenantId: string;
    clientId: string | null;
    groupJid: string | null;
    internalPurpose: string;
  }) {
    const label = 'interno';
    return this.prisma.contactLabel.upsert({
      where: { tenantId_label: { tenantId: data.tenantId, label } },
      create: {
        tenantId: data.tenantId,
        label,
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
}
