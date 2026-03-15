export class ConversationSummaryDto {
  id: string;
  lastMessage: string | null;
  isActive: boolean;
  updatedAt: Date;

  summary: string | null;

  constructor(data: { id: string; isActive: boolean; lastMessagePreview: string | null; summary: string | null; updatedAt: Date }) {
    this.id = data.id;
    this.isActive = data.isActive;
    this.summary = data.summary;
    this.lastMessage = data.lastMessagePreview;
    this.updatedAt = data.updatedAt;
  }
}

export class ContactSearchResponseDto {
  id: string;
  name: string | null;
  phone: string;
  conversations: ConversationSummaryDto[];

  constructor(client: {
    id: string;
    name: string | null;
    phoneNumber: string;
    participations: { conversation: { id: string; isActive: boolean; lastMessagePreview: string | null; summary: string | null; updatedAt: Date } }[];
  }) {
    this.id = client.id;
    this.name = client.name;
    this.phone = client.phoneNumber;
    this.conversations = client.participations.map(
      (p) => new ConversationSummaryDto(p.conversation),
    );
  }
}
