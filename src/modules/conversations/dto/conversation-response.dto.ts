import { Conversation, Client, Phone, ConversationParticipant } from '@prisma/client';

export class ConversationResponseDto {
  id: string;
  phoneId: string;
  clientId: string | null;
  type: string;
  groupName: string | null;
  groupPictureUrl: string | null;
  mode: string;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
  isActive: boolean;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Datos del cliente (null para grupos)
  client: {
    id: string;
    phoneNumber: string;
    name: string | null;
    profilePicUrl: string | null;
    firstContactAt: Date;
    lastContactAt: Date;
  } | null;

  // Participantes (todos para grupos, 1 para individuales)
  participants: {
    id: string;
    phoneNumber: string;
    name: string | null;
    profilePicUrl: string | null;
  }[];

  // Datos del phone
  phone: {
    id: string;
    phoneNumber: string;
    instanceName: string;
    status: string;
  };

  constructor(conversation: Conversation & { client: Client | null; phone: Phone; participants?: (ConversationParticipant & { client: Client })[] }) {
    this.id = conversation.id;
    this.phoneId = conversation.phoneId;
    this.clientId = conversation.clientId;
    this.type = conversation.type;
    this.groupName = conversation.groupName ?? null;
    this.groupPictureUrl = (conversation as any).groupPictureUrl ?? null;
    this.mode = conversation.mode;
    this.lastMessageAt = conversation.lastMessageAt;
    this.lastMessagePreview = conversation.lastMessagePreview;
    this.isActive = conversation.isActive;
    this.summary = conversation.summary;
    this.createdAt = conversation.createdAt;
    this.updatedAt = conversation.updatedAt;

    this.client = conversation.client
      ? {
          id: conversation.client.id,
          phoneNumber: conversation.client.phoneNumber,
          name: conversation.client.name,
          profilePicUrl: conversation.client.profilePicUrl,
          firstContactAt: conversation.client.firstContactAt,
          lastContactAt: conversation.client.lastContactAt,
        }
      : null;

    this.participants = (conversation.participants ?? []).map((p) => ({
      id: p.client.id,
      phoneNumber: p.client.phoneNumber,
      name: p.client.name,
      profilePicUrl: p.client.profilePicUrl,
    }));

    this.phone = {
      id: conversation.phone.id,
      phoneNumber: conversation.phone.phoneNumber,
      instanceName: conversation.phone.instanceName,
      status: conversation.phone.status,
    };
  }
}
