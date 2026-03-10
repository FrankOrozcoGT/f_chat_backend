import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

const DEFAULT_FAREWELL = '¡Gracias por contactarnos! Que tengas un excelente día.';

@Injectable()
export class TemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string, userId: string): Promise<string> {
    const template = await this.prisma.template.findUnique({
      where: { code_userId: { code, userId } },
    });
    if (code === 'farewell') {
      return template?.content ?? DEFAULT_FAREWELL;
    }
    if (!template) {
      throw new Error(`Template '${code}' not found for user ${userId}`);
    }
    return template.content;
  }

  async upsert(code: string, userId: string, content: string) {
    return this.prisma.template.upsert({
      where: { code_userId: { code, userId } },
      update: { content },
      create: { code, userId, content },
    });
  }
}
