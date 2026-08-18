import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MessageProcessorService } from '../services/message-processor.service';
import { ContactSyncService } from '../services/contact-sync.service';
import { GroupSyncService } from '../services/group-sync.service';
import { ChatSyncService } from '../services/chat-sync.service';
import { WebhookJobData } from '../services/phone-queue.service';
import type {
  EvolutionWebhookEvent,
  EvolutionContactUpsert,
  EvolutionGroupUpsert,
  EvolutionChatSet,
} from '../types/evolution-webhook.types';
import type { EvolutionMessage } from '@common/evolution/evolution.service';

@Processor('phone-webhooks', { concurrency: 1 })
export class PhoneQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(PhoneQueueProcessor.name);

  constructor(
    private readonly messageProcessor: MessageProcessorService,
    private readonly contactSyncService: ContactSyncService,
    private readonly groupSyncService: GroupSyncService,
    private readonly chatSyncService: ChatSyncService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { type, phoneId, tenantId, instanceName, webhookData } = job.data;

    this.logger.log(
      `[process] job=${job.id} type=${type} phone=${phoneId} attempt=${job.attemptsMade + 1}`,
    );

    switch (type) {
      case 'process-message':
        await this.messageProcessor.processMessage(
          phoneId,
          instanceName,
          webhookData as EvolutionWebhookEvent<EvolutionMessage & { profilePicUrl?: string | null }>,
        );
        break;

      case 'sync-contacts':
        await this.contactSyncService.syncContacts(
          phoneId,
          tenantId,
          webhookData as EvolutionWebhookEvent<EvolutionContactUpsert[]>,
        );
        break;

      case 'sync-group':
        await this.groupSyncService.syncGroup(
          phoneId,
          instanceName,
          webhookData as EvolutionWebhookEvent<EvolutionGroupUpsert[] | EvolutionGroupUpsert>,
        );
        break;

      case 'sync-chats':
        await this.chatSyncService.syncChats(
          phoneId,
          webhookData as EvolutionWebhookEvent<EvolutionChatSet[]>,
        );
        break;

      default:
        this.logger.warn(`[process] Unknown job type: ${type}`);
    }

    this.logger.log(`[process] job=${job.id} type=${type} completed`);
  }
}
