import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { TenantRole } from '@prisma/client';
import { TenantRepository } from './repositories/tenant.repository';
import { InvitationRepository } from './repositories/invitation.repository';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { EmailService } from '@common/services/email.service';
import { TenantResponseDto, TenantWithRoleDto } from './dto/tenant-response.dto';
import { MemberResponseDto } from './dto/member-response.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';

interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  tenantRole: TenantRole;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly invitationRepository: InvitationRepository,
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
  ) {}

  async createTenant(dto: CreateTenantDto, user: AuthenticatedUser) {
    const tenant = await this.tenantRepository.create({
      name: dto.name,
      ownerId: user.id,
    });
    return new TenantResponseDto(tenant);
  }

  async getMyTenants(user: AuthenticatedUser) {
    const memberships = await this.tenantRepository.findByUserId(user.id);
    return memberships.map(
      (m) =>
        new TenantWithRoleDto({ id: m.tenant.id, name: m.tenant.name, role: m.role }),
    );
  }

  async getTenant(id: string, user: AuthenticatedUser) {
    const member = await this.tenantRepository.findMember(id, user.id);
    if (!member) throw new ForbiddenException('Not a member of this tenant');

    const tenant = await this.tenantRepository.findById(id);
    if (!tenant) throw new NotFoundException('Tenant not found');

    return new TenantResponseDto(tenant);
  }

  async updateTenant(id: string, dto: UpdateTenantDto, user: AuthenticatedUser) {
    if (user.tenantId !== id) throw new ForbiddenException('Not your current tenant');
    const tenant = await this.tenantRepository.updateName(id, dto.name);
    return new TenantResponseDto(tenant);
  }

  async getMembers(id: string, user: AuthenticatedUser) {
    if (user.tenantId !== id) throw new ForbiddenException('Not your current tenant');
    const members = await this.tenantRepository.findMembers(id);
    return members.map((m) => new MemberResponseDto(m));
  }

  async inviteMember(id: string, dto: InviteMemberDto, user: AuthenticatedUser) {
    if (user.tenantId !== id) throw new ForbiddenException('Not your current tenant');

    const tenant = await this.tenantRepository.findById(id);
    if (!tenant) throw new NotFoundException('Tenant not found');

    // Verificar si ya es miembro (registrado o no, primero chequear)
    const targetUser = await this.userRepository.findByEmail(dto.email);
    if (targetUser) {
      const existing = await this.tenantRepository.findMember(id, targetUser.id);
      if (existing) throw new BadRequestException('User is already a member of this tenant');
    }

    // Siempre usar invitación + email
    const existingInvitation = await this.invitationRepository.findPendingByEmail(id, dto.email);
    if (existingInvitation) {
      throw new BadRequestException('There is already a pending invitation for this email');
    }

    const invitation = await this.invitationRepository.create({
      tenantId: id,
      email: dto.email,
      role: dto.role,
    });

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const acceptUrl = `${frontendUrl}/invitations/accept/${invitation.token}`;

    await this.emailService.sendTenantInvitation({
      to: dto.email,
      tenantName: tenant.name,
      inviterName: user.name,
      role: dto.role,
      acceptUrl,
    });

    return { type: 'invited', email: dto.email, role: dto.role };
  }

  async cancelInvitation(id: string, invitationId: string, user: AuthenticatedUser) {
    if (user.tenantId !== id) throw new ForbiddenException('Not your current tenant');

    const invitation = await this.invitationRepository.findById(invitationId);
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.tenantId !== id) throw new ForbiddenException('Invitation does not belong to this tenant');
    if (invitation.acceptedAt) throw new BadRequestException('Cannot cancel an already accepted invitation');

    await this.invitationRepository.deleteById(invitationId);
    return { message: 'Invitation cancelled' };
  }

  async getPendingInvitations(user: AuthenticatedUser) {
    const invitations = await this.invitationRepository.findPendingByUserEmail(user.email);
    return invitations.map((inv) => ({
      id: inv.id,
      token: inv.token,
      role: inv.role,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      tenant: inv.tenant,
    }));
  }

  async acceptInvitation(token: string, user: AuthenticatedUser) {
    const invitation = await this.invitationRepository.findByToken(token);

    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt) throw new BadRequestException('Invitation already accepted');
    if (invitation.rejectedAt) throw new BadRequestException('Invitation already rejected');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');
    if (invitation.email !== user.email) {
      throw new UnauthorizedException('This invitation is for a different email');
    }

    const existing = await this.tenantRepository.findMember(invitation.tenantId, user.id);
    if (existing) throw new BadRequestException('You are already a member of this tenant');

    await this.tenantRepository.addMember(invitation.tenantId, user.id, invitation.role);
    await this.invitationRepository.markAccepted(token);

    return { tenantId: invitation.tenantId, role: invitation.role };
  }

  async rejectInvitation(token: string, user: AuthenticatedUser) {
    const invitation = await this.invitationRepository.findByToken(token);

    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt) throw new BadRequestException('Invitation already accepted');
    if (invitation.rejectedAt) throw new BadRequestException('Invitation already rejected');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');
    if (invitation.email !== user.email) {
      throw new UnauthorizedException('This invitation is for a different email');
    }

    await this.invitationRepository.markRejected(token);
    return { message: 'Invitation rejected' };
  }

  async updateMemberRole(
    id: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
    user: AuthenticatedUser,
  ) {
    if (user.tenantId !== id) throw new ForbiddenException('Not your current tenant');
    if (targetUserId === user.id) throw new BadRequestException('Cannot change your own role');

    const member = await this.tenantRepository.findMember(id, targetUserId);
    if (!member) throw new NotFoundException('Member not found');

    const updated = await this.tenantRepository.updateMemberRole(id, targetUserId, dto.role);
    return { userId: updated.userId, role: updated.role };
  }

  async removeMember(id: string, targetUserId: string, user: AuthenticatedUser) {
    if (user.tenantId !== id) throw new ForbiddenException('Not your current tenant');
    if (targetUserId === user.id) throw new BadRequestException('Cannot remove yourself from tenant');

    const member = await this.tenantRepository.findMember(id, targetUserId);
    if (!member) throw new NotFoundException('Member not found');

    await this.tenantRepository.removeMember(id, targetUserId);
    return { message: 'Member removed' };
  }
}
