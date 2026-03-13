import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ContactLabelRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string) {
    return this.prisma.contactLabel.findMany({
      where: { userId },
      include: { client: true },
    });
  }

  async findByUserIdAndLabel(userId: string, label: string) {
    return this.prisma.contactLabel.findUnique({
      where: { userId_label: { userId, label } },
      include: { client: true },
    });
  }

  async findByClientPhone(phoneNumber: string) {
    return this.prisma.contactLabel.findMany({
      where: { client: { phoneNumber } },
      include: { client: true },
    });
  }

  async upsert(userId: string, label: string, clientId: string) {
    return this.prisma.contactLabel.upsert({
      where: { userId_label: { userId, label } },
      create: { userId, label, clientId },
      update: { clientId },
      include: { client: true },
    });
  }
}
