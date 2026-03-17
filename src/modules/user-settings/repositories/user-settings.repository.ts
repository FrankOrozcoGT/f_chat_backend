// @deprecated — Replaced by TenantSettingsRepository. This file is kept as a stub to avoid import errors.
// TODO: Delete this file once all references are removed.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class UserSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}
}
