import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';

@Injectable()
export class BatchAnalysisService {
  private readonly logger = new Logger(BatchAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: ConversationAnalysisService,
    private readonly clientLabelRepo: ClientLabelRepository,
    private readonly conversationAnalysisRepo: ConversationAnalysisRepository,
  ) {}

  async runBatch(
    tenantId: string,
    channelCount: number,
    messageLimit: number,
  ): Promise<{ analyzed: number; internalsDetected: number }> {
    const conversations = await this.getActiveConversations(tenantId, channelCount);

    let analyzed = 0;
    let internalsDetected = 0;

    for (const conversation of conversations) {
      try {
        const result = await this.analysisService.runAnalysis(
          conversation,
          tenantId,
          messageLimit,
        );

        if (result.warnings.some((w) => w.type === 'no_messages')) {
          this.logger.log(`Skipping conversation ${conversation.id}: no messages`);
          continue;
        }

        analyzed++;

        await this.conversationAnalysisRepo.upsertInternal({
          conversationId: conversation.id,
          isInternal: result.isInternal,
          internalPurpose: result.internalPurpose,
        });

        if (result.isInternal) {
          internalsDetected++;
          const client = conversation.client;
          await this.clientLabelRepo.upsertDraftLabel({
            tenantId,
            clientId: client?.id ?? null,
            groupJid: conversation.groupJid ?? null,
            internalPurpose: result.internalPurpose ?? '',
          });
        }
      } catch (error) {
        this.logger.error(
          `Batch analysis failed for conversation ${conversation.id}: ${error.message}`,
        );
      }
    }

    return { analyzed, internalsDetected };
  }

  private async getActiveConversations(tenantId: string, channelCount: number) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        isActive: true,
        phone: { tenantId },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: channelCount,
      select: {
        id: true,
        phoneId: true,
        groupJid: true,
        phone: { select: { id: true, tenantId: true } },
        participants: {
          take: 1,
          select: { client: { select: { id: true, phoneNumber: true, name: true } } },
        },
      },
    });

    return conversations.map((c) => ({
      id: c.id,
      phoneId: c.phoneId,
      groupJid: c.groupJid,
      phone: c.phone,
      client: c.participants[0]?.client ?? null,
    }));
  }
}
