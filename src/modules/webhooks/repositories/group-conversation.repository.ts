import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Conversation } from '@prisma/client';

@Injectable()
export class GroupConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: {
    phoneId: string;
    groupJid: string;
    groupName?: string;
  }): Promise<Conversation> {
    return this.prisma.conversation.upsert({
      where: { groupJid: data.groupJid },
      create: {
        phoneId: data.phoneId,
        groupJid: data.groupJid,
        groupName: data.groupName || null,
        type: 'group',
        isActive: true,
      },
      update: {
        groupName: data.groupName || undefined,
      },
    });
  }

  async updateGroupInfo(groupJid: string, data: { groupName?: string; groupPictureUrl?: string | null }) {
    await this.prisma.conversation.updateMany({
      where: { groupJid },
      data: {
        ...(data.groupName && { groupName: data.groupName }),
        groupPictureUrl: data.groupPictureUrl ?? null,
      },
    });
  }
}
