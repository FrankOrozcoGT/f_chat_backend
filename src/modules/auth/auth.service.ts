import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, TenantRole, SystemRole } from '@prisma/client';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { TenantRepository } from '@modules/tenants/repositories/tenant.repository';
import type { GoogleProfile } from '@modules/auth/strategies/google.strategy';

interface AuthenticatedUser extends User {
  tenantId: string;
  tenantRole: TenantRole;
  systemRole: SystemRole;
}

export interface JwtPayload {
  userId: string;
  email: string;
  tenantId: string;
  tenantRole: TenantRole;
  systemRole: SystemRole;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly tenantRepository: TenantRepository,
    private readonly jwtService: JwtService,
  ) {}

  async handleGoogleLogin(
    googleProfile: GoogleProfile,
  ): Promise<{ user: User; tenantId: string; tenantRole: TenantRole; token: string }> {
    const { email, name, picture } = googleProfile;

    let user = await this.userRepository.findByEmail(email);
    let tenantId: string;
    let tenantRole: TenantRole;

    if (!user) {
      // Nuevo usuario: crear user + tenant + TenantMember(owner)
      user = await this.userRepository.create({ email, name, picture });
      const tenant = await this.tenantRepository.create({
        name,
        ownerId: user.id,
      });
      tenantId = tenant.id;
      tenantRole = TenantRole.owner;
    } else {
      // Usuario existente: actualizar lastLogin, obtener primer tenant
      user = await this.userRepository.updateLastLogin(user.id);
      const member = await this.tenantRepository.findFirstByUserId(user.id);
      if (!member) {
        throw new InternalServerErrorException('User has no tenant membership');
      }
      tenantId = member.tenantId;
      tenantRole = member.role;
    }

    const token = this.generateJWT({
      userId: user.id,
      email: user.email,
      tenantId,
      tenantRole,
      systemRole: user.systemRole,
    });

    return { user, tenantId, tenantRole, token };
  }

  generateJWT(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }

  async validateUserFromToken(userId: string): Promise<User | null> {
    return this.userRepository.findById(userId);
  }

  async getMe(user: AuthenticatedUser) {
    const [tenantWithSettings, memberships] = await Promise.all([
      this.tenantRepository.findByIdWithSettings(user.tenantId),
      this.tenantRepository.findByUserId(user.id),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      tenant: tenantWithSettings
        ? {
            id: tenantWithSettings.id,
            name: tenantWithSettings.name,
            plan: tenantWithSettings.settings?.plan ?? 'free',
            whatsappLimit: tenantWithSettings.settings?.whatsappLimit ?? 1,
            creditsLimit: tenantWithSettings.settings?.creditsLimit ?? 0,
            creditsUsed: tenantWithSettings.settings?.creditsUsed ?? 0,
          }
        : null,
      tenantRole: user.tenantRole,
      systemRole: user.systemRole,
      availableTenants: memberships.map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        role: m.role,
      })),
    };
  }

  async switchTenant(tenantId: string, user: AuthenticatedUser): Promise<{ token: string; tenantRole: TenantRole }> {
    const member = await this.tenantRepository.findMember(tenantId, user.id);
    if (!member) throw new ForbiddenException('Not a member of this tenant');

    const token = this.generateJWT({
      userId: user.id,
      email: user.email,
      tenantId,
      tenantRole: member.role,
      systemRole: user.systemRole,
    });

    return { token, tenantRole: member.role };
  }
}
