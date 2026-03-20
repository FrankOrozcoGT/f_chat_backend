import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantMemoryRepository } from './repositories/tenant-memory.repository';
import { TenantRole, Prisma } from '@prisma/client';

interface AuthenticatedUser {
  id: string;
  tenantId: string;
  tenantRole: TenantRole;
}

@Controller('api/tenant-memory')
@UseGuards(JwtAuthGuard)
export class TenantMemoryController {
  constructor(private readonly repo: TenantMemoryRepository) {}

  @Get()
  async getAll(@CurrentUser() user: AuthenticatedUser) {
    const record = await this.repo.findByTenantId(user.tenantId);
    return record?.data ?? {};
  }

  @Get(':key')
  async getKey(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    const value = await this.repo.getKey(user.tenantId, key);
    if (value === null) throw new NotFoundException(`Key "${key}" not found`);
    return { key, value };
  }

  @Put('*path')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async upsertPath(
    @CurrentUser() user: AuthenticatedUser,
    @Param('path') rawPath: string,
    @Body() body: { value: Prisma.InputJsonValue },
  ) {
    const path = rawPath.split('/').filter(Boolean);
    if (path.length === 0) throw new BadRequestException('Path cannot be empty');
    if (path.length > 5) throw new BadRequestException('Path depth cannot exceed 5 levels');

    const record = await this.repo.upsertPath(user.tenantId, path, body.value);
    return record.data;
  }

  @Delete(':key')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async deleteKey(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    const record = await this.repo.deleteKey(user.tenantId, key);
    if (!record) throw new NotFoundException(`Key "${key}" not found`);
    return record.data;
  }
}
