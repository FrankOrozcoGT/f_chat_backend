import { IsEmail, IsEnum } from 'class-validator';
import { TenantRole } from '@prisma/client';

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(TenantRole)
  role: TenantRole;
}
