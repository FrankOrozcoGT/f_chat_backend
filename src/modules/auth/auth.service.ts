import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { UserRepository } from '../../common/database/repositories/user.repository';
import { User, Plan, Role } from '@prisma/client';

@Injectable()
export class AuthService {
  private oauth2Client: any;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
    );
  }

  async authenticateWithGoogle(code: string): Promise<{ user: User; token: string }> {
    try {
      // Exchange code por access_token
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);

      // Obtener perfil de usuario de Google
      const oauth2 = google.oauth2({
        auth: this.oauth2Client,
        version: 'v2',
      });

      const { data } = await oauth2.userinfo.get();

      if (!data.email || !data.name) {
        throw new UnauthorizedException('No se pudo obtener información del usuario de Google');
      }

      // Buscar usuario por email
      let user = await this.userRepository.findByEmail(data.email);

      if (!user) {
        // Usuario nuevo: crear con role y plan según ADMIN_EMAILS
        const adminEmails = this.configService.get<string>('ADMIN_EMAILS')?.split(',') || [];
        const isAdmin = adminEmails.includes(data.email);

        user = await this.userRepository.create({
          email: data.email,
          name: data.name,
          picture: data.picture || undefined,
          plan: isAdmin ? Plan.PRO : Plan.FREE,
          role: isAdmin ? Role.ADMIN : Role.USER,
        });
      } else {
        // Usuario existente: actualizar lastLogin
        user = await this.userRepository.updateLastLogin(user.id);
      }

      // Generar JWT
      const token = this.generateJWT({
        userId: user.id,
        email: user.email,
      });

      return { user, token };
    } catch (error) {
      console.error('Error en authenticateWithGoogle:', error);
      throw new UnauthorizedException('Error al autenticar con Google');
    }
  }

  generateJWT(payload: { userId: string; email: string }): string {
    return this.jwtService.sign(payload);
  }
}
