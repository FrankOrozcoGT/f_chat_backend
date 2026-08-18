import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantSettingsService } from './tenant-settings.service';
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
  constructor(private readonly tenantSettingsService: TenantSettingsService) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<SettingsResponseDto> {
    return this.tenantSettingsService.get(user.tenantId);
  }

  @Patch()
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsResponseDto> {
    return this.tenantSettingsService.update(user.tenantId, dto);
  }
}
