import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Invitation, TenantRole } from '@prisma/client';

@Injectable()
export class InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    tenantId: string;
    email: string;
    role: TenantRole;
  }): Promise<Invitation> {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    return this.prisma.invitation.create({
      data: {
        tenantId: data.tenantId,
        email: data.email,
        role: data.role,
        expiresAt,
      },
    });
  }

  async findByToken(token: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({ where: { token } });
  }

  async findPendingByEmail(tenantId: string, email: string): Promise<Invitation | null> {
    return this.prisma.invitation.findFirst({
      where: {
        tenantId,
        email,
        acceptedAt: null,
        rejectedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  async markAccepted(token: string): Promise<void> {
    await this.prisma.invitation.update({
      where: { token },
      data: { acceptedAt: new Date() },
    });
  }

  async findPendingByUserEmail(email: string): Promise<(Invitation & { tenant: { id: string; name: string } })[]> {
    return this.prisma.invitation.findMany({
      where: {
        email,
        acceptedAt: null,
        rejectedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({ where: { id } });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.invitation.delete({ where: { id } });
  }

  async markRejected(token: string): Promise<void> {
    await this.prisma.invitation.update({
      where: { token },
      data: { rejectedAt: new Date() },
    });
  }
}
