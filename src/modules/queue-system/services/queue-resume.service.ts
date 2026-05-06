import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueRequestRepository } from '../repositories/queue-request.repository';
import { PrismaService } from '@common/prisma/prisma.service';

export const QUEUE_RESUME_MESSAGE_PREFIX = 'queue-resume-';

@Injectable()
export class QueueResumeService {
  private readonly logger = new Logger(QueueResumeService.name);

  constructor(
    private readonly queueRequestRepo: QueueRequestRepository,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('queue.response.received')
  async handleQueueResponse(payload: { queueRequestId: string; messageId: string }) {
    const queueRequest = await this.queueRequestRepo.findById(payload.queueRequestId);
    if (!queueRequest) {
      this.logger.warn(`[resume] QueueRequest ${payload.queueRequestId} not found`);
      return;
    }

    // Get conversation details for the synthetic message
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: queueRequest.conversationId },
      include: {
        phone: true,
        participants: { include: { client: true } },
      },
    });

    if (!conversation) {
      this.logger.error(`[resume] Conversation ${queueRequest.conversationId} not found`);
      return;
    }

    const clientPhone = conversation.participants[0]?.client?.phoneNumber ?? null;

    const queueContext = `[RESPUESTA DE COLA - ${queueRequest.label}]: ${queueRequest.responseMessage}`;

    await this.prisma.nodeSession.update({
      where: { id: queueRequest.nodeSessionId },
      data: { status: 'active' },
    });

    this.eventEmitter.emit('ai.incoming.message', {
      messageId: `${QUEUE_RESUME_MESSAGE_PREFIX}${queueRequest.id}`,
      conversationId: queueRequest.conversationId,
      instanceName: queueRequest.instanceName,
      clientPhone,
      tenantId: conversation.phone.tenantId,
      userId: queueRequest.userId,
      messageType: 'text',
      content: queueRequest.responseMessage,
      mediaRelativePath: null,
      mediaMetadata: null,
      queueContext,
      isTest: queueRequest.isTest,
    });

    this.logger.log(
      `[resume] Reactivated nodeSession ${queueRequest.nodeSessionId} with response from ${queueRequest.label}`,
    );
  }
}
