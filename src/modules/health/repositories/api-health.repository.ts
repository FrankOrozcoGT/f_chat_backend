import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ApiName, HealthStatus } from '@prisma/client';

@Injectable()
export class ApiHealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async markAsDown(apiName: ApiName, errorMessage: string) {
    return this.prisma.apiHealth.upsert({
      where: { apiName },
      create: {
        apiName,
        status: 'down',
        monitoringActive: true,
        errorMessage,
        lastErrorAt: new Date(),
        lastCheckAt: new Date(),
      },
      update: {
        status: 'down',
        monitoringActive: true,
        errorMessage,
        lastErrorAt: new Date(),
        lastCheckAt: new Date(),
        recoveredAt: null,
      },
    });
  }

  async markAsUp(apiName: ApiName, responseTimeMs?: number) {
    return this.prisma.apiHealth.upsert({
      where: { apiName },
      create: {
        apiName,
        status: 'up',
        monitoringActive: false,
        responseTimeMs,
        lastCheckAt: new Date(),
        recoveredAt: new Date(),
      },
      update: {
        status: 'up',
        monitoringActive: false,
        errorMessage: null,
        responseTimeMs,
        lastCheckAt: new Date(),
        recoveredAt: new Date(),
      },
    });
  }

  async getAPIsToMonitor() {
    return this.prisma.apiHealth.findMany({
      where: { monitoringActive: true },
    });
  }

  async getAllApiHealth() {
    return this.prisma.apiHealth.findMany();
  }

  async findByApiName(apiName: ApiName) {
    return this.prisma.apiHealth.findUnique({
      where: { apiName },
    });
  }
}
