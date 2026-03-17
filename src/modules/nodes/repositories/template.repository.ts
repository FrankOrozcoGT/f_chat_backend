import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

const DEFAULT_FAREWELL = '¡Gracias por contactarnos! Que tengas un excelente día.';

@Injectable()
export class TemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string, tenantId: string): Promise<string> {
    const template = await this.prisma.template.findUnique({
      where: { code_tenantId: { code, tenantId } },
    });
    if (code === 'farewell') {
      return template?.content ?? DEFAULT_FAREWELL;
    }
    if (!template) {
      throw new Error(`Template '${code}' not found for tenant ${tenantId}`);
    }
    return template.content;
  }

  async upsert(code: string, tenantId: string, content: string) {
    return this.prisma.template.upsert({
      where: { code_tenantId: { code, tenantId } },
      update: { content },
      create: { code, tenantId, content },
    });
  }
}
