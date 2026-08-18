import { MessageType } from '@prisma/client';

export interface IncomingMessageEvent {
  messageId: string;
  conversationId: string;
  instanceName: string;
  clientPhone: string;
  tenantId: string;
  messageType: MessageType;
  content: string | null;
  transcription?: string | null;
  mediaRelativePath: string | null;
  mediaMetadata: { fileName: string; mimeType: string } | null;
  isTest?: boolean;
  fromHitl?: boolean;
  conversationSummary?: string | null;
  queueContext?: string | null;
}
