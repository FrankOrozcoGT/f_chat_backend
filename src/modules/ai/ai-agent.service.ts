import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageType } from '@prisma/client';
import { AiWorkflow } from './langgraph/workflow';

export interface IncomingMessageEvent {
  messageId: string;
  conversationId: string;
  instanceName: string;
  clientPhone: string;
  userId: string;
  messageType: MessageType;
  content: string | null;
  mediaRelativePath: string | null;
  mediaMetadata: { fileName: string; mimeType: string } | null;
}

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(private readonly workflow: AiWorkflow) {}

  @OnEvent('ai.incoming.message')
  async handleIncomingMessage(payload: IncomingMessageEvent): Promise<void> {
    try {
      await this.workflow.execute(payload);
    } catch (error) {
      this.logger.error(`AI processing failed for conversation ${payload.conversationId}: ${error.message}`);
    }
  }
}
