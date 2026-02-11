import { Conversation, Client, Phone } from '@prisma/client';

export class ConversationResponseDto {
  id: string;
  phoneId: string;
  clientId: string;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
  isActive: boolean;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Datos del cliente
  client: {
    id: string;
    phoneNumber: string;
    name: string | null;
    firstContactAt: Date;
    lastContactAt: Date;
  };

  // Datos del phone
  phone: {
    id: string;
    phoneNumber: string;
    instanceName: string;
    status: string;
  };

  constructor(
    conversation: Conversation & { client: Client; phone: Phone },
  ) {
    this.id = conversation.id;
    this.phoneId = conversation.phoneId;
    this.clientId = conversation.clientId;
    this.lastMessageAt = conversation.lastMessageAt;
    this.lastMessagePreview = conversation.lastMessagePreview;
    this.isActive = conversation.isActive;
    this.summary = conversation.summary;
    this.createdAt = conversation.createdAt;
    this.updatedAt = conversation.updatedAt;

    this.client = {
      id: conversation.client.id,
      phoneNumber: conversation.client.phoneNumber,
      name: conversation.client.name,
      firstContactAt: conversation.client.firstContactAt,
      lastContactAt: conversation.client.lastContactAt,
    };

    this.phone = {
      id: conversation.phone.id,
      phoneNumber: conversation.phone.phoneNumber,
      instanceName: conversation.phone.instanceName,
      status: conversation.phone.status,
    };
  }
}
