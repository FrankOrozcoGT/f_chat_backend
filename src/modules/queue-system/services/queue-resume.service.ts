import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueRequestRepository } from '../repositories/queue-request.repository';
import { NodeSessionRepository } from '@modules/nodes/repositories/node-session.repository';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class QueueResumeService {
  private readonly logger = new Logger(QueueResumeService.name);

  constructor(
    private readonly queueRequestRepo: QueueRequestRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('queue.response.received')
  async handleQueueResponse(payload: { queueRequestId: string }) {
    const queueRequest = await this.queueRequestRepo.findById(payload.queueRequestId);
    if (!queueRequest) {
      this.logger.warn(`[resume] QueueRequest ${payload.queueRequestId} not found`);
      return;
    }

    // Reactivate nodeSession
    await this.nodeSessionRepo.updateStatus(queueRequest.nodeSessionId, 'active');

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

    // Emit synthetic ai.incoming.message with the queue response as content
    // The content includes the queue context so the AI knows this is a response
    const syntheticContent = `[RESPUESTA DE COLA - ${queueRequest.label}]: ${queueRequest.responseMessage}`;

    this.eventEmitter.emit('ai.incoming.message', {
      messageId: null, // synthetic, no real message
      conversationId: queueRequest.conversationId,
      instanceName: queueRequest.instanceName,
      clientPhone,
      userId: queueRequest.userId,
      messageType: 'text',
      content: syntheticContent,
      mediaRelativePath: null,
      mediaMetadata: null,
    });

    this.logger.log(
      `[resume] Reactivated nodeSession ${queueRequest.nodeSessionId} with response from ${queueRequest.label}`,
    );
  }
}
