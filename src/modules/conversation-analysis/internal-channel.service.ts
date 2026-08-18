import { BadRequestException, Injectable } from '@nestjs/common';
import { InternalChannelReviewRepository } from './repositories/internal-channel-review.repository';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { ReviewInternalDto } from './dto/review-internal.dto';
import { MarkInternalDto } from './dto/mark-internal.dto';

@Injectable()
export class InternalChannelService {
  constructor(
    private readonly internalChannelReviewRepo: InternalChannelReviewRepository,
    private readonly clientLabelRepo: ClientLabelRepository,
    private readonly conversationAnalysisRepo: ConversationAnalysisRepository,
  ) {}

  async getInternalReviews(tenantId: string) {
    return this.internalChannelReviewRepo.findByTenantId(tenantId);
  }

  async reviewInternal(id: string, tenantId: string, dto: ReviewInternalDto) {
    const updated = await this.internalChannelReviewRepo.review(id, {
      status: dto.status,
      modifiedPurpose: dto.modifiedPurpose,
    });

    if (dto.status === 'approved') {
      const purpose = dto.modifiedPurpose ?? updated.internalPurpose;
      await this.applyApprovedInternalChannel(id, tenantId, {
        clientId: updated.clientId,
        groupJid: updated.groupJid,
        channelName: updated.channelName,
        internalPurpose: purpose,
      });
    }

    return updated;
  }

  async markClientAsInternal(clientId: string, tenantId: string, dto: MarkInternalDto) {
    const review = await this.internalChannelReviewRepo.upsert({
      tenantId,
      clientId,
      groupJid: null,
      internalPurpose: dto.internalPurpose,
      channelName: dto.channelName,
    });
    await this.internalChannelReviewRepo.review(review.id, { status: 'approved' });

    await this.applyApprovedInternalChannel(review.id, tenantId, {
      clientId,
      groupJid: null,
      channelName: dto.channelName,
      internalPurpose: dto.internalPurpose,
    });

    return { clientId, channelName: dto.channelName, status: 'approved' };
  }

  async markGroupAsInternal(groupJid: string, tenantId: string, dto: MarkInternalDto) {
    const review = await this.internalChannelReviewRepo.upsert({
      tenantId,
      clientId: null,
      groupJid,
      internalPurpose: dto.internalPurpose,
      channelName: dto.channelName,
    });
    await this.internalChannelReviewRepo.review(review.id, { status: 'approved' });

    await this.applyApprovedInternalChannel(review.id, tenantId, {
      clientId: null,
      groupJid,
      channelName: dto.channelName,
      internalPurpose: dto.internalPurpose,
    });

    return { groupJid, channelName: dto.channelName, status: 'approved' };
  }

  /**
   * Propaga la aprobación de un canal interno: etiqueta al cliente/grupo y
   * marca sus análisis históricos como internos. Requiere que el
   * InternalChannelReview con `reviewId` ya esté en status 'approved'.
   */
  private async applyApprovedInternalChannel(
    reviewId: string,
    tenantId: string,
    data: {
      clientId: string | null;
      groupJid: string | null;
      channelName: string | null;
      internalPurpose: string | null;
    },
  ) {
    if (!data.channelName) {
      throw new BadRequestException(`Cannot approve internal channel ${reviewId}: channelName is missing`);
    }
    if (!data.internalPurpose) {
      throw new BadRequestException(`Cannot approve internal channel ${reviewId}: internalPurpose is missing`);
    }

    await this.clientLabelRepo.upsertDraftLabel({
      tenantId,
      clientId: data.clientId ?? null,
      groupJid: data.groupJid ?? null,
      internalPurpose: data.internalPurpose,
      channelName: data.channelName,
    });

    if (data.clientId) {
      await this.conversationAnalysisRepo.markAllAsInternalByClient(data.clientId, data.internalPurpose);
    }
    if (data.groupJid) {
      await this.conversationAnalysisRepo.markAllAsInternalByGroup(data.groupJid, data.internalPurpose);
    }
  }
}
