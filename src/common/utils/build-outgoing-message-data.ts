import { MessageType, MessageStatus } from '@prisma/client';

export function buildOutgoingMessageData(
  conversationId: string,
  type: MessageType,
  content: string,
  status: MessageStatus,
  mediaUrl?: string | null,
  evolutionKeyId?: string,
  fileName?: string | null,
  fileSize?: number | null,
  mimeType?: string | null,
  senderType: 'agent' | 'bot' | 'system' = 'agent',
  quotedMessageId?: string,
) {
  const metadata: Record<string, any> = {};
  if (evolutionKeyId) metadata.keyId = evolutionKeyId;
  if (quotedMessageId) metadata.quotedMessageId = quotedMessageId;

  return {
    conversationId,
    type,
    content,
    mediaUrl: mediaUrl || null,
    fileName: fileName || null,
    fileSize: fileSize || null,
    mimeType: mimeType || null,
    direction: 'outgoing' as const,
    senderType,
    status,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}
