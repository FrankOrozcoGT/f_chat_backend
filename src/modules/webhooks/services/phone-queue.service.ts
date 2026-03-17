import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface WebhookJobData {
  type: 'process-message' | 'sync-contacts' | 'sync-group' | 'sync-chats';
  phoneId: string;
  tenantId: string;
  instanceName: string;
  webhookData: any;
  attempt?: number;
}

@Injectable()
export class PhoneQueueService {
  private readonly logger = new Logger(PhoneQueueService.name);

  constructor(
    @InjectQueue('phone-webhooks') private readonly queue: Queue,
  ) {}

  async enqueue(job: WebhookJobData): Promise<void> {
    await this.queue.add(job.type, job, {
      attempts: 1,
      backoff: { type: 'fixed', delay: 2000 },
    });
    this.logger.log(
      `[enqueue] ${job.type} phone=${job.phoneId}`,
    );
  }

  /**
   * Encolar con retry para cuando el phone aún no existe en DB.
   * Se reintenta 1 vez con 2s de delay.
   */
  async enqueueWithRetry(job: WebhookJobData): Promise<void> {
    await this.queue.add(job.type, job, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 2000 },
    });
    this.logger.log(
      `[enqueue-retry] ${job.type} phone=${job.phoneId}`,
    );
  }
}
