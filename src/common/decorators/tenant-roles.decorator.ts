import { SetMetadata } from '@nestjs/common';
import { TenantRole } from '@prisma/client';

export const TENANT_ROLES_KEY = 'tenantRoles';
export const TenantRoles = (...roles: TenantRole[]) =>
  SetMetadata(TENANT_ROLES_KEY, roles);
