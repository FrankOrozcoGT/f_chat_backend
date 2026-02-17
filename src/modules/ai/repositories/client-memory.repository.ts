import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ClientMemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(clientId: string, key: string, value: any) {
    return this.prisma.clientMemory.upsert({
      where: { clientId_key: { clientId, key } },
      update: { value },
      create: { clientId, key, value },
    });
  }

  async findByClientId(clientId: string) {
    return this.prisma.clientMemory.findMany({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findByKey(clientId: string, key: string) {
    return this.prisma.clientMemory.findUnique({
      where: { clientId_key: { clientId, key } },
    });
  }
}
