import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { TenantSettingsRepository } from './repositories/tenant-settings.repository';

@Controller('internal/tenant-settings')
@UseGuards(InternalGuard)
export class InternalTenantSettingsController {
  constructor(
    private readonly tenantSettingsRepository: TenantSettingsRepository,
  ) {}

  @Get(':tenantId')
  async getByTenantId(@Param('tenantId') tenantId: string) {
    const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    return (
      settings ?? {
        analysisMode: 'manual',
        messageLimit: 30,
        defaultShippingCost: 0,
        workSchedule: {
          '1': { start: 8, end: 18 },
          '2': { start: 8, end: 18 },
          '3': { start: 8, end: 18 },
          '4': { start: 8, end: 18 },
          '5': { start: 8, end: 18 },
          '6': { start: 8, end: 12 },
        },
      }
    );
  }

  @Patch(':tenantId/credits')
  async incrementCredits(
    @Param('tenantId') tenantId: string,
    @Body('credits') credits: number,
  ) {
    return this.tenantSettingsRepository.incrementCreditsUsed(tenantId, credits);
  }
}
