import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Phone, PhoneStatus } from '@prisma/client';

@Injectable()
export class PhoneRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByTenantId(tenantId: string): Promise<Phone[]> {
    return this.prisma.phone.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    tenantId: string;
    instanceName: string;
    evolutionInstanceId: string;
    status: PhoneStatus;
    phoneNumber: string;
    qrCode?: string;
  }): Promise<Phone> {
    return this.prisma.phone.create({ data });
  }

  async findByEvolutionInstanceId(evolutionInstanceId: string): Promise<Phone | null> {
    return this.prisma.phone.findUnique({ where: { evolutionInstanceId } });
  }

  async updateStatus(id: string, status: PhoneStatus, lastConnected?: Date): Promise<Phone> {
    return this.prisma.phone.update({
      where: { id },
      data: { status, ...(lastConnected && { lastConnected }) },
    });
  }

  async findById(id: string): Promise<Phone | null> {
    return this.prisma.phone.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<Phone> {
    return this.prisma.phone.delete({ where: { id } });
  }

  async findFirstByTenantId(tenantId: string): Promise<Phone | null> {
    return this.prisma.phone.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countActiveByTenantId(tenantId: string): Promise<number> {
    return this.prisma.phone.count({
      where: { tenantId, status: { in: ['pending', 'connected'] } },
    });
  }
}
