import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Tenant, TenantMember, TenantRole } from '@prisma/client';

export type TenantWithSettings = Tenant & {
  settings: {
    plan: string;
    whatsappLimit: number;
    creditsLimit: number;
    creditsUsed: number;
  } | null;
};

export type TenantMemberWithUser = TenantMember & {
  user: { id: string; email: string; name: string; picture: string | null };
};

export type TenantMemberWithTenant = TenantMember & {
  tenant: Tenant;
};

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { name: string; ownerId: string }): Promise<Tenant> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: data.name },
      });
      await tx.tenantMember.create({
        data: {
          tenantId: tenant.id,
          userId: data.ownerId,
          role: TenantRole.owner,
        },
      });
      await tx.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          plan: 'free',
          creditsLimit: 0,
          creditsUsed: 0,
          whatsappLimit: 1,
        },
      });
      return tenant;
    });
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  async findByIdWithSettings(id: string): Promise<TenantWithSettings | null> {
    return this.prisma.tenant.findUnique({
      where: { id },
      include: {
        settings: {
          select: {
            plan: true,
            whatsappLimit: true,
            creditsLimit: true,
            creditsUsed: true,
          },
        },
      },
    });
  }

  async findByUserId(userId: string): Promise<TenantMemberWithTenant[]> {
    return this.prisma.tenantMember.findMany({
      where: { userId },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findFirstByUserId(
    userId: string,
  ): Promise<TenantMemberWithTenant | null> {
    return this.prisma.tenantMember.findFirst({
      where: { userId },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMember(
    tenantId: string,
    userId: string,
  ): Promise<TenantMember | null> {
    return this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
  }

  async findMembers(tenantId: string): Promise<TenantMemberWithUser[]> {
    return this.prisma.tenantMember.findMany({
      where: { tenantId },
      include: {
        user: {
          select: { id: true, email: true, name: true, picture: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMember(
    tenantId: string,
    userId: string,
    role: TenantRole,
  ): Promise<TenantMember> {
    return this.prisma.tenantMember.create({
      data: { tenantId, userId, role },
    });
  }

  async updateMemberRole(
    tenantId: string,
    userId: string,
    role: TenantRole,
  ): Promise<TenantMember> {
    return this.prisma.tenantMember.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { role },
    });
  }

  async removeMember(tenantId: string, userId: string): Promise<void> {
    await this.prisma.tenantMember.delete({
      where: { tenantId_userId: { tenantId, userId } },
    });
  }

  async updateName(tenantId: string, name: string): Promise<Tenant> {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { name },
    });
  }
}
