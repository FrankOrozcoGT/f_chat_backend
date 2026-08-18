import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  UseGuards,
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
import { AUTH_TOKEN_COOKIE, buildAuthCookieOptions } from './auth-cookie.util';

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

    res.cookie(AUTH_TOKEN_COOKIE, token, this.cookieOptions());

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/dashboard`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user);
  }

  @Post('tenants/switch/:tenantId')
  @UseGuards(JwtAuthGuard)
  async switchTenant(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { token, tenantRole } = await this.authService.switchTenant(tenantId, user);

    res.cookie(AUTH_TOKEN_COOKIE, token, this.cookieOptions());

    return res.json({ tenantId, tenantRole });
  }

  @Post('logout')
  logout(@Res() res: Response) {
    res.clearCookie(AUTH_TOKEN_COOKIE, this.cookieOptions());
    return res.status(200).json({ message: 'Logged out successfully' });
  }

  private cookieOptions() {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    return buildAuthCookieOptions(isProduction);
  }
}
