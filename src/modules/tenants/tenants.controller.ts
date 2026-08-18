import { Controller, Get, Patch, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { TenantRolesGuard } from '@common/guards/tenant-roles.guard';
import { TenantRoles } from '@common/decorators/tenant-roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantsService } from './tenants.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantRole } from '@prisma/client';

interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  tenantRole: TenantRole;
}

@Controller('api/tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  async createTenant(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.createTenant(dto, user);
  }

  @Get('mine')
  async getMyTenants(@CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.getMyTenants(user);
  }

  @Get(':id')
  async getTenant(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.getTenant(id, user);
  }

  @Patch(':id')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async updateTenant(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.updateTenant(id, dto, user);
  }

  @Get(':id/members')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async getMembers(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.getMembers(id, user);
  }

  @Post(':id/members/invite')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async inviteMember(
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.inviteMember(id, dto, user);
  }

  @Delete(':id/invitations/:invitationId')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async cancelInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.cancelInvitation(id, invitationId, user);
  }

  @Get('invitations/pending')
  @UseGuards(JwtAuthGuard)
  async getPendingInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.getPendingInvitations(user);
  }

  @Post('invitations/accept/:token')
  @UseGuards(JwtAuthGuard)
  async acceptInvitation(
    @Param('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.acceptInvitation(token, user);
  }

  @Post('invitations/reject/:token')
  @UseGuards(JwtAuthGuard)
  async rejectInvitation(
    @Param('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.rejectInvitation(token, user);
  }

  @Patch(':id/members/:userId/role')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async updateMemberRole(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.updateMemberRole(id, targetUserId, dto, user);
  }

  @Delete(':id/members/:userId')
  @UseGuards(TenantRolesGuard)
  @TenantRoles(TenantRole.owner)
  async removeMember(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.removeMember(id, targetUserId, user);
  }
}
