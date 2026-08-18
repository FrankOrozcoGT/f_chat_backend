import { Injectable, Logger } from '@nestjs/common';
import { TenantSettingsRepository } from './repositories/tenant-settings.repository';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsResponseDto } from './dto/settings-response.dto';

@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);

  constructor(private readonly tenantSettingsRepository: TenantSettingsRepository) {}

  async get(tenantId: string): Promise<SettingsResponseDto> {
    this.logger.log(`get settings - tenantId: ${tenantId}`);
    const settings = await this.tenantSettingsRepository.upsert(tenantId, {});
    return new SettingsResponseDto(settings);
  }

  async update(tenantId: string, dto: UpdateSettingsDto): Promise<SettingsResponseDto> {
    this.logger.log(`update settings - tenantId: ${tenantId}, data: ${JSON.stringify(dto)}`);
    const settings = await this.tenantSettingsRepository.upsert(tenantId, dto);
    return new SettingsResponseDto(settings);
  }
}
