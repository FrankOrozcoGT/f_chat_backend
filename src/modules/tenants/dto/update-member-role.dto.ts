import { IsEnum } from 'class-validator';
import { TenantRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  @IsEnum(TenantRole)
  role: TenantRole;
}
