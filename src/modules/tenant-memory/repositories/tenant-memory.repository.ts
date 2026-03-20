import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class TenantMemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string) {
    return this.prisma.tenantMemory.findUnique({ where: { tenantId } });
  }

  async getKey(tenantId: string, key: string): Promise<Prisma.JsonValue | null> {
    const record = await this.prisma.tenantMemory.findUnique({ where: { tenantId } });
    if (!record) return null;
    const data = record.data as Record<string, Prisma.JsonValue>;
    return data[key] ?? null;
  }

  async getKeys(tenantId: string, keys: string[]): Promise<Record<string, Prisma.JsonValue>> {
    const record = await this.prisma.tenantMemory.findUnique({ where: { tenantId } });
    if (!record) return {};
    const data = record.data as Record<string, Prisma.JsonValue>;
    const result: Record<string, Prisma.JsonValue> = {};
    for (const key of keys) {
      if (data[key] !== undefined) result[key] = data[key];
    }
    return result;
  }

  async upsertKey(tenantId: string, key: string, value: Prisma.InputJsonValue) {
    const existing = await this.prisma.tenantMemory.findUnique({ where: { tenantId } });
    const current = (existing?.data as Record<string, Prisma.InputJsonValue>) ?? {};
    const merged: Record<string, Prisma.InputJsonValue> = { ...current, [key]: value };

    return this.prisma.tenantMemory.upsert({
      where: { tenantId },
      create: { tenantId, data: merged },
      update: { data: merged },
    });
  }

  async upsertPath(tenantId: string, path: string[], value: Prisma.InputJsonValue) {
    const existing = await this.prisma.tenantMemory.findUnique({ where: { tenantId } });
    const current = (existing?.data as Record<string, Prisma.InputJsonValue>) ?? {};
    const merged = this.setNestedValue(current, path, value);

    return this.prisma.tenantMemory.upsert({
      where: { tenantId },
      create: { tenantId, data: merged },
      update: { data: merged },
    });
  }

  private setNestedValue(
    obj: Record<string, Prisma.InputJsonValue>,
    path: string[],
    value: Prisma.InputJsonValue,
  ): Record<string, Prisma.InputJsonValue> {
    const [head, ...rest] = path;
    if (rest.length === 0) {
      return { ...obj, [head]: value };
    }
    const child = (obj[head] as Record<string, Prisma.InputJsonValue>) ?? {};
    return { ...obj, [head]: this.setNestedValue(child, rest, value) };
  }

  async deleteKey(tenantId: string, key: string) {
    const existing = await this.prisma.tenantMemory.findUnique({ where: { tenantId } });
    if (!existing) return null;
    const current: Record<string, Prisma.InputJsonValue> = { ...(existing.data as Record<string, Prisma.InputJsonValue>) };
    delete current[key];

    return this.prisma.tenantMemory.update({
      where: { tenantId },
      data: { data: current },
    });
  }
}
