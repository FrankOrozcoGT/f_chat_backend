import { Exclude } from 'class-transformer';
import { Plan, Role } from '@prisma/client';

export class UserResponseDto {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  plan: Plan;
  role: Role;
  whatsappLimit: number;
  creditsLimit: number;
  creditsUsed: number;
  billingPeriodStart: Date;
  lastLogin: Date | null;
  createdAt: Date;

  @Exclude()
  updatedAt: Date;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
