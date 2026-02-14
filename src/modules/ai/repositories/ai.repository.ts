import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ApiType } from '@prisma/client';

export interface CreateApiCallData {
  messageId: string;
  apiType: ApiType;
  operation: string;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd: number;
  latencyMs: number;
  errorMessage?: string;
}

@Injectable()
export class AiRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveApiCalls(apiCalls: CreateApiCallData[]) {
    return this.prisma.apiCall.createMany({
      data: apiCalls,
    });
  }

  async saveMessage(messageId: string, costUsd: number) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { costUsd },
    });
  }
}
