import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { InternalReviewStatus } from '@prisma/client';

@Injectable()
export class InternalChannelReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    type ReviewRow = {
      id: string; tenantId: string; clientId: string | null; groupJid: string | null;
      internalPurpose: string | null; status: string; modifiedPurpose: string | null;
      reviewedAt: Date | null; createdAt: Date; updatedAt: Date;
      conversationIds: string[];
    };

    const rows = await this.prisma.$queryRaw<(Omit<ReviewRow, 'conversationIds'> & { conversationIds: string })[]>`
      SELECT
        r.*,
        COALESCE(
          array_agg(c.id) FILTER (WHERE c.id IS NOT NULL),
          '{}'
        )::text[] AS "conversationIds"
      FROM "InternalChannelReview" r
      LEFT JOIN "Conversation" c ON c."phoneId" IN (
        SELECT id FROM "Phone" WHERE "tenantId" = ${tenantId}
      ) AND (
        (r."groupJid" IS NOT NULL AND c."groupJid" = r."groupJid")
        OR
        (r."clientId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "ConversationParticipant" cp
          WHERE cp."conversationId" = c.id AND cp."clientId" = r."clientId"
        ))
      )
      WHERE r."tenantId" = ${tenantId}
      GROUP BY r.id
      ORDER BY r."createdAt" DESC
    `;

    return rows.map((r) => ({
      ...r,
      conversationIds: Array.isArray(r.conversationIds) ? r.conversationIds : [],
    }));
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
  }): Promise<{ id: string; status: InternalReviewStatus; internalPurpose: string | null } | null> {
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
      select: { id: true, status: true, internalPurpose: true },
    });
  }

  async upsert(data: {
    tenantId: string;
    clientId: string | null;
    groupJid: string | null;
    internalPurpose: string | null;
    channelName: string | null;
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
          channelName: data.channelName,
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
        channelName: data.channelName,
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
