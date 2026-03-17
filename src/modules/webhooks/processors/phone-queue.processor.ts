import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhookProcessorService } from '../services/webhook-processor.service';
import { WebhookJobData } from '../services/phone-queue.service';

@Processor('phone-webhooks', { concurrency: 1 })
export class PhoneQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(PhoneQueueProcessor.name);

  constructor(
    private readonly webhookProcessor: WebhookProcessorService,
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
        await this.webhookProcessor.processMessage(phoneId, instanceName, webhookData);
        break;

      case 'sync-contacts':
        await this.webhookProcessor.syncContacts(phoneId, tenantId, webhookData);
        break;

      case 'sync-group':
        await this.webhookProcessor.syncGroup(phoneId, instanceName, webhookData);
        break;

      case 'sync-chats':
        await this.webhookProcessor.syncChats(phoneId, webhookData);
        break;

      default:
        this.logger.warn(`[process] Unknown job type: ${type}`);
    }

    this.logger.log(`[process] job=${job.id} type=${type} completed`);
  }
}
