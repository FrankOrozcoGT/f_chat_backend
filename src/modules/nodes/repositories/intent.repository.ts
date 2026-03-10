import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class IntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string) {
    return this.prisma.intent.findMany({
      where: { userId },
      include: { flow: true },
    });
  }

  async findByUserIdAndName(userId: string, name: string) {
    return this.prisma.intent.findUnique({
      where: { userId_name: { userId, name } },
      include: { flow: true },
    });
  }

  async upsert(userId: string, name: string, flowId?: string) {
    return this.prisma.intent.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name, flowId },
      update: { flowId },
      include: { flow: true },
    });
  }

  async delete(userId: string, name: string) {
    return this.prisma.intent.delete({
      where: { userId_name: { userId, name } },
    });
  }
}
