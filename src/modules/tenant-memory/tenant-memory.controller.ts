import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantMemoryService } from './tenant-memory.service';
import { TenantRole, Prisma } from '@prisma/client';

interface AuthenticatedUser {
  id: string;
  tenantId: string;
  tenantRole: TenantRole;
}

@Controller('api/tenant-memory')
@UseGuards(JwtAuthGuard)
export class TenantMemoryController {
  constructor(private readonly tenantMemoryService: TenantMemoryService) {}

  @Get()
  async getAll(@CurrentUser() user: AuthenticatedUser) {
    return this.tenantMemoryService.getAll(user.tenantId);
  }

  @Get(':key')
  async getKey(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    return this.tenantMemoryService.getKey(user.tenantId, key);
  }

  @Put('*path')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async upsertPath(
    @CurrentUser() user: AuthenticatedUser,
    @Param('path') rawPath: string,
    @Body() body: { value: Prisma.InputJsonValue },
  ) {
    return this.tenantMemoryService.upsertPath(user.tenantId, rawPath, body.value);
  }

  @Delete(':key')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async deleteKey(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    return this.tenantMemoryService.deleteKey(user.tenantId, key);
  }
}
