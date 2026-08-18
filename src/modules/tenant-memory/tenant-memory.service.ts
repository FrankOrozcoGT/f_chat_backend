import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantMemoryRepository } from './repositories/tenant-memory.repository';

const MAX_PATH_DEPTH = 5;

@Injectable()
export class TenantMemoryService {
  constructor(private readonly repo: TenantMemoryRepository) {}

  async getAll(tenantId: string) {
    const record = await this.repo.findByTenantId(tenantId);
    return record?.data ?? {};
  }

  async getKey(tenantId: string, key: string) {
    const value = await this.repo.getKey(tenantId, key);
    if (value === null) throw new NotFoundException(`Key "${key}" not found`);
    return { key, value };
  }

  async upsertPath(tenantId: string, rawPath: string, value: Prisma.InputJsonValue) {
    const path = rawPath.split('/').filter(Boolean);
    if (path.length === 0) throw new BadRequestException('Path cannot be empty');
    if (path.length > MAX_PATH_DEPTH) {
      throw new BadRequestException(`Path depth cannot exceed ${MAX_PATH_DEPTH} levels`);
    }

    const record = await this.repo.upsertPath(tenantId, path, value);
    return record.data;
  }

  async deleteKey(tenantId: string, key: string) {
    const record = await this.repo.deleteKey(tenantId, key);
    if (!record) throw new NotFoundException(`Key "${key}" not found`);
    return record.data;
  }
}
