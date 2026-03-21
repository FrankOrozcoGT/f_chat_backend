import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

export interface RawMessageStats {
  clientId: string;
  activeDay: string;
  messageCount: number;
}

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getMessageStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<RawMessageStats[]> {
    const result = await this.prisma.$queryRaw<RawMessageStats[]>`
      SELECT
        cp."clientId",
        DATE(m."createdAt") AS "activeDay",
        COUNT(m.id)::int     AS "messageCount"
      FROM "Message" m
      INNER JOIN "Conversation" c  ON c.id = m."conversationId"
      INNER JOIN "Phone" p         ON p.id = c."phoneId"
      INNER JOIN "ConversationParticipant" cp ON cp."conversationId" = c.id
      WHERE
        p."tenantId" = ${tenantId}
        AND m."createdAt" >= ${from}
        AND m."createdAt" <= ${to}
      GROUP BY cp."clientId", DATE(m."createdAt")
      ORDER BY cp."clientId", "activeDay"
    `;

    return result;
  }
}
