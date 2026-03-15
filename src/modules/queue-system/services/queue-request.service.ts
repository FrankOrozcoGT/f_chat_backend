import { Injectable, Logger } from '@nestjs/common';
import { QueueRequestRepository } from '../repositories/queue-request.repository';
import { ContactLabelService } from './contact-label.service';
import { UserQueueManager } from './user-queue-manager.service';

export interface EnqueueParams {
  userId: string;
  nodeSessionId: string;
  conversationId: string;
  currentNodeId: string;
  instanceName: string;
  label: string;
  message: string;
  imageUrl?: string;
  isTest?: boolean;
  toolName: string;
  toolContext?: any;
}

@Injectable()
export class QueueRequestService {
  private readonly logger = new Logger(QueueRequestService.name);

  constructor(
    private readonly queueRequestRepo: QueueRequestRepository,
    private readonly contactLabelService: ContactLabelService,
    private readonly userQueueManager: UserQueueManager,
  ) {}

  async enqueue(params: EnqueueParams) {
    const { userId, label, message } = params;

    // Resolve label → remoteJid (individual or group)
    const resolved = await this.contactLabelService.resolve(userId, label);

    // Create QueueRequest record
    const queueRequest = await this.queueRequestRepo.create({
      userId: params.userId,
      nodeSessionId: params.nodeSessionId,
      conversationId: params.conversationId,
      currentNodeId: params.currentNodeId,
      instanceName: params.instanceName,
      label,
      destinationPhone: resolved.isGroup ? '' : resolved.remoteJid.replace('@s.whatsapp.net', ''),
      groupJid: resolved.isGroup ? resolved.remoteJid : null,
      outgoingMessage: message,
      imageUrl: params.imageUrl ?? null,
      isTest: params.isTest ?? false,
      toolName: params.toolName,
      toolContext: params.toolContext,
    });

    // Add job to user's queue (pause/resume handled by QueueSchedulerService)
    await this.userQueueManager.addJob(userId, { queueRequestId: queueRequest.id });

    this.logger.log(`[enqueue] Created QueueRequest ${queueRequest.id} label=${label} dest=${resolved.remoteJid}`);

    return { queueRequest };
  }

  async handleResponse(instanceName: string, senderPhone: string, responseMessage: string, groupJid?: string) {
    // Find the pending sent request — by groupJid if from a group, otherwise by individual phone
    const queueRequest = groupJid
      ? await this.queueRequestRepo.findPendingByGroup(groupJid)
      : await this.queueRequestRepo.findPendingByDestination(senderPhone);
    if (!queueRequest) return null;

    // Update request with response
    await this.queueRequestRepo.updateStatus(queueRequest.id, 'responded', {
      responseMessage,
      respondedAt: new Date(),
    });

    this.logger.log(`[handleResponse] QueueRequest ${queueRequest.id} responded by ${senderPhone}${groupJid ? ` in group ${groupJid}` : ''}`);

    return queueRequest;
  }
}
