import { Injectable, Logger } from '@nestjs/common';
import { ClientRepository } from '@common/messaging/repositories/client.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { GroupConversationRepository } from '../repositories/group-conversation.repository';
import { EvolutionService } from '@common/evolution/evolution.service';
import type {
  EvolutionWebhookEvent,
  EvolutionGroupUpsert,
} from '../types/evolution-webhook.types';

@Injectable()
export class GroupSyncService {
  private readonly logger = new Logger(GroupSyncService.name);

  constructor(
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly groupConversationRepository: GroupConversationRepository,
    private readonly evolutionService: EvolutionService,
  ) {}

  /**
   * Procesa groups.upsert — metadata de grupos
   */
  async syncGroup(
    phoneId: string,
    instanceName: string,
    webhookData: EvolutionWebhookEvent<EvolutionGroupUpsert[] | EvolutionGroupUpsert>,
  ) {
    const groups: EvolutionGroupUpsert[] = Array.isArray(webhookData?.data)
      ? webhookData.data
      : [webhookData?.data];
    const validGroups = groups.filter((g) => g?.id);

    // Bulk delete comunidades que chats.set pudo haber creado
    const communityJids = validGroups
      .filter((g) => g.isCommunity === true)
      .map((g) => g.id as string);

    if (communityJids.length > 0) {
      const deleted = await this.groupConversationRepository.deleteManyByGroupJids(communityJids);
      this.logger.log(`[groups.upsert] Deleted ${deleted} communities: ${communityJids.join(', ')}`);
    }

    // Procesar solo grupos reales
    const realGroups = validGroups.filter((g) => g.isCommunity !== true);

    for (const group of realGroups) {
      const groupJid = group.id;
      const groupName = group.subject || null;
      const groupPictureUrl = group.pictureUrl || null;
      const participants: { id: string }[] = group.participants || [];

      this.logger.log(`[groups.upsert] groupJid=${groupJid} groupName=${groupName} pictureUrl=${groupPictureUrl} participants=${participants.length} keys=${Object.keys(group).join(',')}`);

      const conversation = await this.groupConversationRepository.upsert({ phoneId, groupJid, groupName: groupName || undefined });

      const pictureUrl = await this.evolutionService.fetchProfilePictureUrl(instanceName, groupJid);
      this.logger.log(`[groups.upsert] fetchProfilePictureUrl result for ${groupJid}: ${pictureUrl}`);
      await this.groupConversationRepository.updateGroupInfo(groupJid, {
        groupName: groupName || undefined,
        groupPictureUrl: pictureUrl ?? groupPictureUrl,
      });

      for (const p of participants) {
        if (p.id.endsWith('@lid')) {
          this.logger.warn(`[groups.upsert] LID participant in group ${groupJid} — full object: ${JSON.stringify(p)}`);
          continue;
        }
        const phoneNumber = p.id.replace('@s.whatsapp.net', '').replace('@c.us', '');
        if (!phoneNumber) continue;
        const client = await this.clientRepository.upsert({ phoneNumber, name: phoneNumber });
        await this.conversationRepository.upsertParticipant(conversation.id, client.id);
      }
    }
  }
}
