import { EvolutionMessage } from '@common/evolution/evolution.service';

export interface EvolutionWebhookEvent<T = unknown> {
  event: string;
  instance: string;
  data: T;
}

export interface ConnectionUpdateData {
  state?: 'open' | 'close' | 'connecting';
}

export interface QrCodeUpdateData {
  qrcode?: string;
  qr?: string;
}

export interface MessagesSetData {
  isLatest?: boolean;
  progress?: number;
}

export interface MessagesUpdateData {
  keyId: string;
  status: string;
  fromMe: boolean;
}

export interface ContactUpdateEntry {
  remoteJid?: string;
  profilePicUrl?: string;
}

export interface EvolutionContactUpsert {
  remoteJid?: string;
  pushName?: string;
  profilePicUrl?: string | null;
}

export interface EvolutionGroupParticipant {
  id: string;
}

export interface EvolutionGroupUpsert {
  id: string;
  subject?: string;
  pictureUrl?: string;
  isCommunity?: boolean;
  participants?: EvolutionGroupParticipant[];
}

export interface EvolutionChatSet {
  remoteJid?: string;
  name?: string;
}

export type MessageUpsertWebhook = EvolutionWebhookEvent<EvolutionMessage>;
export type ConnectionUpdateWebhook = EvolutionWebhookEvent<ConnectionUpdateData>;
export type QrCodeUpdateWebhook = EvolutionWebhookEvent<QrCodeUpdateData>;
export type MessagesSetWebhook = EvolutionWebhookEvent<MessagesSetData>;
export type MessagesUpdateWebhook = EvolutionWebhookEvent<MessagesUpdateData>;
export type ContactsUpdateWebhook = EvolutionWebhookEvent<ContactUpdateEntry | ContactUpdateEntry[]>;
export type ContactsUpsertWebhook = EvolutionWebhookEvent<EvolutionContactUpsert[]>;
export type GroupsUpsertWebhook = EvolutionWebhookEvent<EvolutionGroupUpsert[] | EvolutionGroupUpsert>;
export type ChatsSetWebhook = EvolutionWebhookEvent<EvolutionChatSet[]>;
