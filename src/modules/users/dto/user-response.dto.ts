import { Exclude } from 'class-transformer';
import { SystemRole } from '@prisma/client';

export class UserResponseDto {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  systemRole: SystemRole;
  lastLogin: Date | null;
  createdAt: Date;

  @Exclude()
  updatedAt: Date;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
