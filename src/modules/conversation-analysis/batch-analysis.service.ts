import { Injectable, Logger } from '@nestjs/common';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { InternalChannelReviewRepository } from './repositories/internal-channel-review.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { groupAnalysesByIntent } from './utils/group-analyses-by-intent';
import { ensureError } from '@common/utils/ensure-error';

@Injectable()
export class BatchAnalysisService {
  private readonly logger = new Logger(BatchAnalysisService.name);

  constructor(
    private readonly analysisService: ConversationAnalysisService,
    private readonly internalChannelReviewRepo: InternalChannelReviewRepository,
    private readonly conversationAnalysisRepo: ConversationAnalysisRepository,
    private readonly conversationRepo: ConversationRepository,
  ) {}

  async runBatch(
    tenantId: string,
    channelCount: number,
    messageLimit: number,
  ): Promise<{ analyzed: number; internalsDetected: number; totalCostUsd: number; intents: { intent: string; count: number }[]; internals: { conversationId: string; clientId: string | null; groupJid: string | null; internalPurpose: string | null }[] }> {
    const conversations = await this.conversationRepo.findActiveForBatchAnalysis(tenantId, channelCount);

    let analyzed = 0;
    let internalsDetected = 0;
    let totalCostUsd = 0;
    const internals: { conversationId: string; clientId: string | null; groupJid: string | null; internalPurpose: string | null }[] = [];
    const accumulatedIntents = new Set<string>();

    for (const conversation of conversations) {
      try {
        const clientId = conversation.client?.id ?? null;
        const groupJid = conversation.groupJid ?? null;

        // Si ya existe una review no-rechazada, verificar si tiene purpose
        const existingReview = await this.internalChannelReviewRepo.findNonRejectedByClientOrGroup({
          tenantId,
          clientId,
          groupJid,
        });

        if (existingReview && existingReview.internalPurpose) {
          internalsDetected++;
          this.logger.log(`Skipping AI for internal conversation ${conversation.id} (review with purpose, status: ${existingReview.status})`);
          continue;
        }

        const knownInternal = !!existingReview;

        const result = await this.analysisService.runAnalysis(
          conversation,
          tenantId,
          messageLimit,
          [...accumulatedIntents],
          knownInternal,
        );

        if (result.warnings.some((w) => w.type === 'no_messages')) {
          this.logger.log(`Skipping conversation ${conversation.id}: no messages`);
          continue;
        }

        analyzed++;
        totalCostUsd += result.creditsUsed;

        // Aplicar renames de intents
        for (const rename of result.intentRenames) {
          if (accumulatedIntents.has(rename.from)) {
            accumulatedIntents.delete(rename.from);
            accumulatedIntents.add(rename.to);
            // Renombrar en analyses anteriores
            await this.conversationAnalysisRepo.renameIntent(rename.from, rename.to, tenantId);
            this.logger.log(`Intent renamed: "${rename.from}" → "${rename.to}"`);
          }
        }

        result.detectedIntents.forEach((i) => accumulatedIntents.add(i));

        await this.conversationAnalysisRepo.upsertInternal({
          conversationId: conversation.id,
          isInternal: result.isInternal,
          internalPurpose: result.internalPurpose,
        });

        if (result.isInternal) {
          internalsDetected++;

          if (groupJid) {
            // Grupo interno: crear review por cada participante con groupJid
            if (result.participants.length === 0) {
              throw new Error(`Group ${conversation.id} marked as internal but AI returned 0 participants`);
            }
            for (const participant of result.participants) {
              const phoneNumber = participant.senderJid.replace('@s.whatsapp.net', '');
              const matchedClient = conversation.allParticipants.find((p) => p.phoneNumber === phoneNumber);
              if (matchedClient) {
                await this.internalChannelReviewRepo.upsert({
                  tenantId,
                  clientId: matchedClient.id,
                  groupJid,
                  internalPurpose: participant.internalPurpose,
                  channelName: participant.channelName,
                });
                this.logger.log(`Created group participant review: ${participant.channelName} → clientId=${matchedClient.id}, groupJid=${groupJid}`);
              }
            }
          } else {
            // Individual interno: una review con clientId
            await this.internalChannelReviewRepo.upsert({
              tenantId,
              clientId,
              groupJid: null,
              internalPurpose: result.internalPurpose,
              channelName: result.channelName,
            });
          }

          internals.push({ conversationId: conversation.id, clientId, groupJid, internalPurpose: result.internalPurpose });
        }
      } catch (e) {
        const error = ensureError(e);
        this.logger.error(
          `Batch analysis failed for conversation ${conversation.id}: ${error.message}`,
        );
      }
    }

    const analyses = await this.conversationAnalysisRepo.findAllByTenantId(tenantId);
    const grouped = groupAnalysesByIntent(analyses);
    const intents = Array.from(grouped.entries()).map(([intent, items]) => ({
      intent,
      description: items.find((a) => a.intentDescription)?.intentDescription ?? null,
      count: items.length,
    }));

    return { analyzed, internalsDetected, totalCostUsd, intents, internals };
  }
}
