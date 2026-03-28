import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { InternalReviewStatus } from '@prisma/client';

@Injectable()
export class InternalChannelReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    return this.prisma.internalChannelReview.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPendingByTenantId(tenantId: string) {
    return this.prisma.internalChannelReview.findMany({
      where: { tenantId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findNonRejectedByClientOrGroup(data: {
    tenantId: string;
    clientId: string | null;
    groupJid: string | null;
  }): Promise<{ id: string; status: InternalReviewStatus } | null> {
    if (!data.clientId && !data.groupJid) return null;
    const conditions: any[] = [];
    if (data.clientId) conditions.push({ clientId: data.clientId });
    if (data.groupJid) conditions.push({ groupJid: data.groupJid });
    return this.prisma.internalChannelReview.findFirst({
      where: {
        tenantId: data.tenantId,
        status: { not: 'rejected' },
        OR: conditions,
      },
      select: { id: true, status: true },
    });
  }

  async upsert(data: {
    tenantId: string;
    clientId: string | null;
    groupJid: string | null;
    internalPurpose: string | null;
  }) {
    const conditions: any[] = [];
    if (data.clientId) conditions.push({ clientId: data.clientId });
    if (data.groupJid) conditions.push({ groupJid: data.groupJid });

    const existing = conditions.length > 0
      ? await this.prisma.internalChannelReview.findFirst({
          where: { tenantId: data.tenantId, OR: conditions },
        })
      : null;

    if (existing) {
      return this.prisma.internalChannelReview.update({
        where: { id: existing.id },
        data: {
          internalPurpose: data.internalPurpose,
          status: 'pending',
          reviewedAt: null,
          modifiedPurpose: null,
        },
      });
    }

    return this.prisma.internalChannelReview.create({
      data: {
        tenantId: data.tenantId,
        clientId: data.clientId,
        groupJid: data.groupJid,
        internalPurpose: data.internalPurpose,
        status: 'pending',
      },
    });
  }

  async review(
    id: string,
    data: { status: 'approved' | 'rejected'; modifiedPurpose?: string | null },
  ) {
    return this.prisma.internalChannelReview.update({
      where: { id },
      data: {
        status: data.status,
        modifiedPurpose: data.status === 'approved' ? (data.modifiedPurpose ?? null) : null,
        reviewedAt: new Date(),
      },
    });
  }
}
