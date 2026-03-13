import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueRequestRepository } from '../repositories/queue-request.repository';
import { ContactLabelService } from './contact-label.service';
import { WorkScheduleService } from './work-schedule.service';
import { NodeSessionRepository } from '@modules/nodes/repositories/node-session.repository';

export interface EnqueueParams {
  userId: string;
  nodeSessionId: string;
  conversationId: string;
  currentNodeId: string;
  instanceName: string;
  label: string;
  message: string;
  toolName: string;
  toolContext?: any;
}

@Injectable()
export class QueueRequestService {
  private readonly logger = new Logger(QueueRequestService.name);

  constructor(
    @InjectQueue('outbound-queue') private readonly outboundQueue: Queue,
    private readonly queueRequestRepo: QueueRequestRepository,
    private readonly contactLabelService: ContactLabelService,
    private readonly workScheduleService: WorkScheduleService,
    private readonly nodeSessionRepo: NodeSessionRepository,
  ) {}

  async enqueue(params: EnqueueParams) {
    const { userId, label, message } = params;

    // Resolve label → client phone
    const { phoneNumber } = await this.contactLabelService.resolve(userId, label);

    // Create QueueRequest record
    const queueRequest = await this.queueRequestRepo.create({
      userId: params.userId,
      nodeSessionId: params.nodeSessionId,
      conversationId: params.conversationId,
      currentNodeId: params.currentNodeId,
      instanceName: params.instanceName,
      label,
      destinationPhone: phoneNumber,
      outgoingMessage: message,
      toolName: params.toolName,
      toolContext: params.toolContext,
    });

    // Mark NodeSession as waiting_queue
    await this.nodeSessionRepo.updateStatus(params.nodeSessionId, 'waiting_queue');

    // Check work hours for delay
    const withinHours = await this.workScheduleService.isWithinWorkHours(userId);
    let delay = 0;

    if (!withinHours) {
      delay = await this.workScheduleService.getDelayUntilNextWorkHour(userId);
      this.logger.log(`[enqueue] Outside work hours, delaying ${delay}ms for request ${queueRequest.id}`);
    }

    // Add job to BullMQ queue
    await this.outboundQueue.add(
      'send-message',
      { queueRequestId: queueRequest.id },
      {
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(`[enqueue] Created QueueRequest ${queueRequest.id} label=${label} dest=${phoneNumber} delay=${delay}`);

    return { queueRequest, isOutsideWorkHours: !withinHours };
  }

  async handleResponse(instanceName: string, senderPhone: string, responseMessage: string) {
    // Find the pending sent request for this sender
    const queueRequest = await this.queueRequestRepo.findPendingByDestination(senderPhone);
    if (!queueRequest) return null;

    // Update request with response
    await this.queueRequestRepo.updateStatus(queueRequest.id, 'responded', {
      responseMessage,
      respondedAt: new Date(),
    });

    this.logger.log(`[handleResponse] QueueRequest ${queueRequest.id} responded by ${senderPhone}`);

    return queueRequest;
  }
}
