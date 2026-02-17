import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { User, Plan, Role } from '@prisma/client';

interface CreateUserData {
  email: string;
  name: string;
  picture?: string;
  plan: Plan;
  role: Role;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async updateLastLogin(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLogin: new Date() },
    });
  }

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateLimits(
    userId: string,
    data: { whatsappLimit?: number; creditsLimit?: number },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async incrementCreditsUsed(userId: string, amount: number): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        creditsUsed: {
          increment: amount,
        },
      },
    });
  }

  async resetBillingPeriod(userId: string): Promise<User> {
    // Obtener usuario actual para calcular deuda
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Calcular deuda: si excedió el límite, la deuda se arrastra al siguiente mes
    const deuda = Math.max(0, user.creditsUsed - user.creditsLimit);

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        creditsUsed: deuda, // Empieza el mes con la deuda
        billingPeriodStart: new Date(),
      },
    });
  }
}
