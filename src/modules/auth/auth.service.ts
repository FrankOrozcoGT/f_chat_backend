import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { User, Plan, Role } from '@prisma/client';
import type { GoogleProfile } from '@modules/auth/strategies/google.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleGoogleLogin(
    googleProfile: GoogleProfile,
  ): Promise<{ user: User; token: string }> {
    const { email, name, picture } = googleProfile;

    // Buscar usuario por email
    let user = await this.userRepository.findByEmail(email);

    if (!user) {
      // Usuario nuevo: crear con role y plan según ADMIN_EMAILS
      const adminEmails =
        this.configService.get<string>('ADMIN_EMAILS')?.split(',') || [];
      const isAdmin = adminEmails.includes(email);

      user = await this.userRepository.create({
        email,
        name,
        picture,
        plan: isAdmin ? Plan.full : Plan.free,
        role: isAdmin ? Role.admin : Role.free,
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
  }

  generateJWT(payload: { userId: string; email: string }): string {
    return this.jwtService.sign(payload);
  }

  async validateUserFromToken(userId: string): Promise<User | null> {
    return this.userRepository.findById(userId);
  }
}
