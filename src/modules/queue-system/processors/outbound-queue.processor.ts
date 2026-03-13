import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueRequestRepository } from '../repositories/queue-request.repository';
import { WorkScheduleService } from '../services/work-schedule.service';
import { EvolutionService } from '@common/evolution/evolution.service';

interface OutboundJobData {
  queueRequestId: string;
}

@Processor('outbound-queue', { concurrency: 1 })
export class OutboundQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundQueueProcessor.name);

  constructor(
    private readonly queueRequestRepo: QueueRequestRepository,
    private readonly workScheduleService: WorkScheduleService,
    private readonly evolutionService: EvolutionService,
  ) {
    super();
  }

  async process(job: Job<OutboundJobData>): Promise<void> {
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

    // Check FIFO: is there another sent (awaiting response) for this destination?
    const existingSent = await this.queueRequestRepo.findPendingSent(
      queueRequest.instanceName,
      queueRequest.destinationPhone,
    );
    if (existingSent) {
      this.logger.log(`[process] Another request ${existingSent.id} is waiting response for ${queueRequest.destinationPhone}, re-queuing`);
      throw new Error('FIFO_WAIT'); // BullMQ will retry with backoff
    }

    // Re-verify work hours
    const withinHours = await this.workScheduleService.isWithinWorkHours(queueRequest.userId);
    if (!withinHours) {
      const delay = await this.workScheduleService.getDelayUntilNextWorkHour(queueRequest.userId);
      this.logger.log(`[process] Outside work hours, re-queuing with delay ${delay}ms`);
      throw new Error('OUTSIDE_WORK_HOURS'); // will retry with backoff
    }

    // Send WhatsApp message
    const remoteJid = `${queueRequest.destinationPhone}@s.whatsapp.net`;
    await this.evolutionService.sendTextMessage(
      queueRequest.instanceName,
      remoteJid,
      queueRequest.outgoingMessage,
    );

    // Update status to sent
    await this.queueRequestRepo.updateStatus(queueRequest.id, 'sent', {
      sentAt: new Date(),
    });

    this.logger.log(`[process] Sent message to ${queueRequest.destinationPhone} for QueueRequest ${queueRequest.id}`);
  }
}
