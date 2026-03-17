import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { AnalysisMode, TenantSettings } from '@prisma/client';

@Injectable()
export class TenantSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<TenantSettings[]> {
    return this.prisma.tenantSettings.findMany();
  }

  async findByTenantId(tenantId: string): Promise<TenantSettings | null> {
    return this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });
  }

  async upsert(
    tenantId: string,
    data: {
      analysisMode?: AnalysisMode;
      messageLimit?: number;
      defaultShippingCost?: number;
      workSchedule?: object;
    },
  ): Promise<TenantSettings> {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        analysisMode: data.analysisMode ?? AnalysisMode.manual,
        messageLimit: data.messageLimit ?? 30,
        defaultShippingCost: data.defaultShippingCost ?? 0,
        workSchedule: data.workSchedule ?? {
          '1': { start: 8, end: 18 },
          '2': { start: 8, end: 18 },
          '3': { start: 8, end: 18 },
          '4': { start: 8, end: 18 },
          '5': { start: 8, end: 18 },
          '6': { start: 8, end: 12 },
        },
      },
      update: data,
    });
  }

  async incrementCreditsUsed(tenantId: string, amount: number): Promise<TenantSettings> {
    return this.prisma.tenantSettings.update({
      where: { tenantId },
      data: { creditsUsed: { increment: amount } },
    });
  }

  async resetBillingPeriod(tenantId: string): Promise<TenantSettings> {
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      throw new Error(`TenantSettings not found for tenantId: ${tenantId}`);
    }

    const deuda = Math.max(0, settings.creditsUsed - settings.creditsLimit);

    return this.prisma.tenantSettings.update({
      where: { tenantId },
      data: {
        creditsUsed: deuda,
        billingPeriodStart: new Date(),
      },
    });
  }

  async updateLimits(
    tenantId: string,
    data: { whatsappLimit?: number; creditsLimit?: number },
  ): Promise<TenantSettings> {
    return this.prisma.tenantSettings.update({
      where: { tenantId },
      data,
    });
  }

  async updatePlan(tenantId: string, plan: 'free' | 'full'): Promise<TenantSettings> {
    return this.prisma.tenantSettings.update({
      where: { tenantId },
      data: { plan },
    });
  }
}
