import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueRequestRepository } from '../repositories/queue-request.repository';
import { EvolutionService, EvolutionMediaType } from '@common/evolution/evolution.service';

interface OutboundJobData {
  queueRequestId: string;
}

interface UserQueue {
  queue: Queue;
  worker: Worker;
}

@Injectable()
export class UserQueueManager implements OnModuleInit {
  private readonly logger = new Logger(UserQueueManager.name);
  private readonly userQueues = new Map<string, UserQueue>();
  private redisConnection: { host: string; port: number; db: number };

  constructor(
    private readonly configService: ConfigService,
    private readonly queueRequestRepo: QueueRequestRepository,
    private readonly evolutionService: EvolutionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6380/1');
    const url = new URL(redisUrl);
    this.redisConnection = {
      host: url.hostname,
      port: parseInt(url.port, 10),
      db: parseInt(url.pathname.replace('/', '') || '0', 10),
    };
  }

  private getQueueName(userId: string): string {
    return `outbound-${userId}`;
  }

  getOrCreateQueue(userId: string): UserQueue {
    const existing = this.userQueues.get(userId);
    if (existing) return existing;

    const queueName = this.getQueueName(userId);

    const queue = new Queue(queueName, {
      connection: this.redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });

    const worker = new Worker<OutboundJobData>(
      queueName,
      async (job: Job<OutboundJobData>) => this.processJob(job),
      {
        connection: this.redisConnection,
        concurrency: 1,
      },
    );

    worker.on('failed', (job, err) => {
      this.logger.error(`[${queueName}] Job ${job?.id} failed: ${err.message}`);
    });

    const userQueue: UserQueue = { queue, worker };
    this.userQueues.set(userId, userQueue);
    this.logger.log(`Created queue ${queueName}`);

    return userQueue;
  }

  private async processJob(job: Job<OutboundJobData>): Promise<void> {
    const { queueRequestId } = job.data;
    const queueRequest = await this.queueRequestRepo.findById(queueRequestId);

    if (!queueRequest) {
      this.logger.warn(`[process] QueueRequest ${queueRequestId} not found, skipping`);
      return;
    }

    if (queueRequest.status !== 'pending') {
      this.logger.log(`[process] QueueRequest ${queueRequestId} status=${queueRequest.status}, skipping`);
      return;
    }

    // Test mode: skip FIFO check and real WhatsApp send, inject synthetic response
    if (queueRequest.isTest) {
      await this.queueRequestRepo.updateStatus(queueRequest.id, 'sent', { sentAt: new Date() });
      this.logger.log(`[process][TEST] Skipping WA send for QueueRequest ${queueRequest.id} label=${queueRequest.label}`);

      const mockResponse = queueRequest.label === 'supervisor' ? 'aprobado' : 'confirmado';
      await this.queueRequestRepo.updateStatus(queueRequest.id, 'responded', {
        responseMessage: mockResponse,
        respondedAt: new Date(),
      });

      this.eventEmitter.emit('queue.response.received', { queueRequestId: queueRequest.id });
      return;
    }

    // Send WhatsApp message
    const remoteJid = queueRequest.groupJid ?? `${queueRequest.destinationPhone}@s.whatsapp.net`;
    let sentResponse;
    if (queueRequest.imageUrl) {
      sentResponse = await this.evolutionService.sendMediaMessage(
        queueRequest.instanceName,
        remoteJid,
        queueRequest.imageUrl,
        EvolutionMediaType.IMAGE,
        queueRequest.outgoingMessage,
      );
    } else {
      sentResponse = await this.evolutionService.sendTextMessage(
        queueRequest.instanceName,
        remoteJid,
        queueRequest.outgoingMessage,
      );
    }

    await this.queueRequestRepo.updateStatus(queueRequest.id, 'sent', {
      sentAt: new Date(),
      sentWhatsappMessageId: sentResponse?.key?.id ?? null,
    });

    this.logger.log(`[process] Sent message to ${remoteJid} for QueueRequest ${queueRequest.id}`);
  }

  async pauseUser(userId: string): Promise<void> {
    const userQueue = this.userQueues.get(userId);
    if (!userQueue) return;
    await userQueue.worker.pause();
    this.logger.log(`Paused queue for user ${userId}`);
  }

  async resumeUser(userId: string): Promise<void> {
    const userQueue = this.userQueues.get(userId);
    if (!userQueue) return;
    userQueue.worker.resume();
    this.logger.log(`Resumed queue for user ${userId}`);
  }

  isUserPaused(userId: string): boolean {
    const userQueue = this.userQueues.get(userId);
    if (!userQueue) return false;
    return userQueue.worker.isPaused();
  }

  async addJob(userId: string, data: OutboundJobData): Promise<void> {
    const { queue } = this.getOrCreateQueue(userId);
    await queue.add('send-message', data);
  }

  async onModuleDestroy() {
    for (const [userId, { queue, worker }] of this.userQueues) {
      await worker.close();
      await queue.close();
      this.logger.log(`Closed queue for user ${userId}`);
    }
    this.userQueues.clear();
  }
}
