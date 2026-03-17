import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantSettingsRepository } from './repositories/tenant-settings.repository';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsResponseDto } from './dto/settings-response.dto';
import { TenantRole } from '@prisma/client';

interface AuthenticatedUser {
  id: string;
  tenantId: string;
  tenantRole: TenantRole;
}

@Controller('api/users/settings')
@UseGuards(JwtAuthGuard)
export class TenantSettingsController {
  private readonly logger = new Logger(TenantSettingsController.name);

  constructor(
    private readonly tenantSettingsRepository: TenantSettingsRepository,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<SettingsResponseDto> {
    this.logger.log(`GET /api/users/settings - tenantId: ${user.tenantId}`);
    const settings = await this.tenantSettingsRepository.upsert(user.tenantId, {});
    return new SettingsResponseDto(settings);
  }

  @Patch()
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsResponseDto> {
    this.logger.log(
      `PATCH /api/users/settings - tenantId: ${user.tenantId}, data: ${JSON.stringify(dto)}`,
    );
    const settings = await this.tenantSettingsRepository.upsert(user.tenantId, dto);
    return new SettingsResponseDto(settings);
  }
}
