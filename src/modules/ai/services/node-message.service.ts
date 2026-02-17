import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class NodeMessageService {
  private readonly logger = new Logger(NodeMessageService.name);

  /**
   * Load messages for a node by its messageIds.
   * Fetches incoming messages by ID + outgoing (bot) responses
   * in the same time window, merged chronologically.
   */
  async loadNodeMessages(
    messageIds: string[],
    conversationId: string,
    prisma: PrismaService,
  ): Promise<ChatMessage[]> {
    if (!messageIds.length) return [];

    // 1. Load incoming messages by IDs
    const incomingMessages = await prisma.message.findMany({
      where: { id: { in: messageIds } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, direction: true, createdAt: true },
    });

    if (!incomingMessages.length) return [];

    // 2. Get time window: from first to last incoming message
    const firstDate = incomingMessages[0].createdAt;
    const lastDate = incomingMessages[incomingMessages.length - 1].createdAt;

    // 3. Load outgoing (bot) messages in that time window
    const outgoingMessages = await prisma.message.findMany({
      where: {
        conversationId,
        direction: 'outgoing',
        createdAt: { gte: firstDate, lte: lastDate },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, direction: true, createdAt: true },
    });

    // 4. Merge and sort chronologically
    const allMessages = [...incomingMessages, ...outgoingMessages].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    // 5. Deduplicate (in case an outgoing message ID was also in messageIds)
    const seen = new Set<string>();
    const result: ChatMessage[] = [];
    for (const msg of allMessages) {
      if (seen.has(msg.id)) continue;
      seen.add(msg.id);
      result.push({
        role: msg.direction === 'incoming' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    this.logger.debug(`Loaded ${result.length} messages for node (${messageIds.length} IDs)`);
    return result;
  }
}
