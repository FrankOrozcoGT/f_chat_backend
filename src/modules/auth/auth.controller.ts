import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { TenantRole, SystemRole } from '@prisma/client';
import { AuthService } from '@modules/auth/auth.service';
import type { GoogleProfile } from '@modules/auth/strategies/google.strategy';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { TenantRepository } from '@modules/tenants/repositories/tenant.repository';

interface AuthenticatedUser extends User {
  tenantId: string;
  tenantRole: TenantRole;
  systemRole: SystemRole;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly tenantRepository: TenantRepository,
  ) {}

  @Get('google-login')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport automáticamente redirige a Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request & { user: GoogleProfile },
    @Res() res: Response,
  ) {
    const { token } = await this.authService.handleGoogleLogin(req.user);

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/dashboard`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: AuthenticatedUser) {
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

  @Post('tenants/switch/:tenantId')
  @UseGuards(JwtAuthGuard)
  async switchTenant(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const member = await this.tenantRepository.findMember(tenantId, user.id);
    if (!member) throw new ForbiddenException('Not a member of this tenant');

    const token = this.authService.generateJWT({
      userId: user.id,
      email: user.email,
      tenantId,
      tenantRole: member.role,
      systemRole: user.systemRole,
    });

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ tenantId, tenantRole: member.role });
  }

  @Post('logout')
  logout(@Res() res: Response) {
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
    });

    return res.status(200).json({ message: 'Logged out successfully' });
  }
}
