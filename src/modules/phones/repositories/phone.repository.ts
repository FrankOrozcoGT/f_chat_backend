import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Phone, PhoneStatus } from '@prisma/client';

@Injectable()
export class PhoneRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUserId(userId: string): Promise<Phone[]> {
    return this.prisma.phone.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    userId: string;
    instanceName: string;
    evolutionInstanceId: string;
    status: PhoneStatus;
    phoneNumber: string;
    qrCode?: string;
  }): Promise<Phone> {
    return this.prisma.phone.create({
      data,
    });
  }

  async findByEvolutionInstanceId(
    evolutionInstanceId: string,
  ): Promise<Phone | null> {
    return this.prisma.phone.findUnique({
      where: { evolutionInstanceId },
    });
  }

  async updateStatus(
    id: string,
    status: PhoneStatus,
    lastConnected?: Date,
  ): Promise<Phone> {
    return this.prisma.phone.update({
      where: { id },
      data: {
        status,
        ...(lastConnected && { lastConnected }),
      },
    });
  }

  async findById(id: string): Promise<Phone | null> {
    return this.prisma.phone.findUnique({
      where: { id },
    });
  }

  async delete(id: string): Promise<Phone> {
    return this.prisma.phone.delete({
      where: { id },
    });
  }

  async findFirstByUserId(userId: string): Promise<Phone | null> {
    return this.prisma.phone.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countActiveByUserId(userId: string): Promise<number> {
    return this.prisma.phone.count({
      where: {
        userId,
        status: {
          in: ['pending', 'connected'],
        },
      },
    });
  }
}
