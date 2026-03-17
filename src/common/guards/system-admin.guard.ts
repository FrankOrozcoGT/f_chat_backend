import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { SystemRole } from '@prisma/client';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    return user?.systemRole === SystemRole.super_admin;
  }
}
