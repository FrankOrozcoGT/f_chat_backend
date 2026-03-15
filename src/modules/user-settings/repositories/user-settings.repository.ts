import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { AnalysisMode } from '@prisma/client';

@Injectable()
export class UserSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string) {
    return this.prisma.userSettings.findUnique({
      where: { userId },
    });
  }

  async findAll() {
    return this.prisma.userSettings.findMany();
  }

  async upsert(
    userId: string,
    data: { analysisMode?: AnalysisMode; messageLimit?: number },
  ) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        analysisMode: data.analysisMode ?? 'manual',
        messageLimit: data.messageLimit ?? 100,
      },
      update: data,
    });
  }
}
