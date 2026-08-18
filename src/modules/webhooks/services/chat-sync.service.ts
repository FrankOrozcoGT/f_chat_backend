import { Injectable, Logger } from '@nestjs/common';
import { GroupConversationRepository } from '../repositories/group-conversation.repository';

@Injectable()
export class ChatSyncService {
  private readonly logger = new Logger(ChatSyncService.name);

  constructor(
    private readonly groupConversationRepository: GroupConversationRepository,
  ) {}

  /**
   * Procesa chats.set — sync inicial de grupos con nombre
   */
  async syncChats(phoneId: string, webhookData: any) {
    const chats: any[] = Array.isArray(webhookData?.data) ? webhookData.data : [];
    const groups = chats.filter((c) => c.remoteJid?.endsWith('@g.us'));
    this.logger.log(`[chats.set] total=${chats.length} groups=${groups.length}`);
    if (groups.length === 0) return;

    for (const group of groups) {
      const groupJid = group.remoteJid;
      const groupName = group.name || null;
      this.logger.log(`[chats.set] upsert groupJid=${groupJid} groupName=${groupName}`);
      await this.groupConversationRepository.upsert({ phoneId, groupJid, groupName: groupName || undefined });
    }
    this.logger.log(`[chats.set] done groups=${groups.length}`);
  }
}
