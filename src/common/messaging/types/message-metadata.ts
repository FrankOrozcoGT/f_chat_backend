export interface MessageMetadata {
  keyId?: string;
  senderJid?: string;
  senderName?: string;
  senderProfilePicUrl?: string;
  quotedMessageId?: string;
}

function isMessageMetadata(value: unknown): value is MessageMetadata {
  return typeof value === 'object' && value !== null;
}

/** Parsea el campo `metadata` (JSON de Prisma, forma no garantizada en compile-time) de un Message. */
export function parseMessageMetadata(raw: unknown): MessageMetadata | null {
  return isMessageMetadata(raw) ? raw : null;
}
