import { Injectable, ForbiddenException } from '@nestjs/common';
import {
  SubConversation,
  AnalysisMessage,
} from './langgraph/analysis-state.interface';

export interface ConversationSplit {
  summary: string;
  messageIds: string[];
}

@Injectable()
export class ConversationAnalysisService {
  validateOwnership(phoneTenantId: string, jwtTenantId: string): void {
    if (phoneTenantId !== jwtTenantId) {
      throw new ForbiddenException(
        'You do not have permission to analyze this conversation',
      );
    }
  }

  buildSplits(
    subConversations: SubConversation[],
    messages: AnalysisMessage[],
  ): ConversationSplit[] {
    return subConversations.map((sub) => {
      const firstIdx = messages.findIndex((m) => m.id === sub.firstMessageId);
      const lastIdx = messages.findIndex((m) => m.id === sub.lastMessageId);

      if (firstIdx === -1 || lastIdx === -1) {
        throw new Error(
          `Invalid message range: firstMessageId=${sub.firstMessageId}, lastMessageId=${sub.lastMessageId}`,
        );
      }

      const messageIds = messages
        .slice(firstIdx, lastIdx + 1)
        .map((m) => m.id);

      return { summary: sub.summary, messageIds };
    });
  }

  /**
   * Encuentra mensajes huérfanos al inicio del batch que no fueron cubiertos por ningún split.
   * Ej: batch msgs [1,2,3,4,5,6...50], primer split empieza en msg 6 → retorna [1,2,3,4,5]
   */
  findOrphanPrefix(
    splits: ConversationSplit[],
    messages: AnalysisMessage[],
  ): string[] {
    if (splits.length === 0) return [];

    const firstSplitMessageId = splits[0].messageIds[0];
    if (!firstSplitMessageId) return [];

    const firstSplitIdx = messages.findIndex((m) => m.id === firstSplitMessageId);
    if (firstSplitIdx <= 0) return [];

    return messages.slice(0, firstSplitIdx).map((m) => m.id);
  }

  decidePriceAction(
    newPrice: number,
    currentBasePrice: number | null,
  ): 'update_base' | 'create_discount' {
    if (currentBasePrice === null) {
      return 'update_base';
    }
    if (newPrice >= currentBasePrice) {
      return 'update_base';
    }
    return 'create_discount';
  }
}
