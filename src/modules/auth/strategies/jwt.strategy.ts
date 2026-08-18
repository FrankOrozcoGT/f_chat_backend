import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService, JwtPayload } from '@modules/auth/auth.service';
import { TenantRepository } from '@modules/tenants/repositories/tenant.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly tenantRepository: TenantRepository,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return request?.cookies?.auth_token;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.authService.validateUserFromToken(payload.userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Lee tenantRole de DB en cada request para que cambios de rol sean inmediatos
    const member = await this.tenantRepository.findMember(
      payload.tenantId,
      payload.userId,
    );

    if (!member) {
      throw new UnauthorizedException('Tenant membership not found');
    }

    return {
      ...user,
      tenantId: payload.tenantId,
      tenantRole: member.role,
      systemRole: user.systemRole,
    };
  }
}
