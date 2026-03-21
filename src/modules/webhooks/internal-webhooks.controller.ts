import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { MessageRepository } from './repositories/message.repository';
import { ClientRepository } from './repositories/client.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { ConversationAnalysisRepository } from '@modules/conversation-analysis/repositories/conversation-analysis.repository';

@Controller('internal/messages')
@UseGuards(InternalGuard)
export class InternalWebhooksController {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly conversationAnalysisRepo: ConversationAnalysisRepository,
  ) {}

  @Post('send-transaction')
  async sendMessageTransaction(
    @Body()
    body: {
      conversationId: string;
      userId: string;
      messageData: any;
      conversationUpdate: { lastMessageAt: string; lastMessagePreview: string };
    },
  ) {
    return this.messageRepository.sendMessageTransaction(
      body.conversationId,
      body.userId,
      body.messageData,
      {
        lastMessageAt: new Date(body.conversationUpdate.lastMessageAt),
        lastMessagePreview: body.conversationUpdate.lastMessagePreview,
      },
    );
  }

  @Patch(':id/transcription')
  async updateTranscription(
    @Param('id') id: string,
    @Body('transcription') transcription: string,
  ) {
    await this.messageRepository.updateTranscription(id, transcription);
  }

  @Get('history/:conversationId')
  async getHistory(
    @Param('conversationId') conversationId: string,
    @Query('take') take?: string,
  ) {
    const limit = take ? parseInt(take, 10) : 31;
    const messages = await this.messageRepository.findByConversationId(
      conversationId,
    );
    const lastN = messages.slice(-limit);
    return lastN.map((m) => ({
      id: m.id,
      content: m.content,
      direction: m.direction,
      mediaRelativePath: m.mediaUrl ?? null,
    }));
  }

  @Get('unanalyzed/:conversationId')
  async findLastNUnanalyzed(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
  ) {
    const take = limit ? parseInt(limit, 10) : 30;
    return this.messageRepository.findLastNUnanalyzed(conversationId, take);
  }

  @Post('mark-analyzed')
  async markAsAnalyzed(@Body('messageIds') messageIds: string[]) {
    return this.messageRepository.markAsAnalyzed(messageIds);
  }

  @Post('move-to-conversation')
  async updateConversationId(
    @Body() body: { messageIds: string[]; newConversationId?: string },
  ) {
    let targetConversationId = body.newConversationId;

    if (!targetConversationId) {
      // Auto-resolve: find the message's current conversation, then find the last closed conversation of the same client
      const message = await this.messageRepository.findById(body.messageIds[0]);
      if (!message) {
        throw new Error(`Message ${body.messageIds[0]} not found`);
      }

      const conversation = await this.conversationRepository.findByIdWithRelations(message.conversationId);
      if (!conversation?.client) {
        throw new Error(`Cannot resolve client for conversation ${message.conversationId}`);
      }

      const lastClosed = await this.conversationRepository.findLastClosedByPhoneAndClient(
        conversation.phoneId,
        conversation.client.id,
      );
      if (!lastClosed) {
        throw new Error(`No previous closed conversation found for client ${conversation.client.id}`);
      }

      targetConversationId = lastClosed.id;
    }

    return this.messageRepository.updateConversationId(
      body.messageIds,
      targetConversationId,
    );
  }

  /**
   * Procesa los splits del análisis: mueve msgs antiguos no enviados a la IA,
   * crea sub-conversaciones, mueve mensajes clasificados, marca como analizados.
   */
  @Post('process-analysis-splits')
  async processAnalysisSplits(
    @Body()
    body: {
      conversationId: string;
      phoneId: string;
      clientId: string;
      batchMessageIds: string[];
      splits: Array<{ summary: string; messageIds: string[]; intent?: string | null; flowDiagram?: string | null; flowSummary?: string | null }>;
      orphanMessageIds: string[];
    },
  ) {
    const { conversationId, phoneId, clientId, batchMessageIds, splits, orphanMessageIds } = body;

    const createdConversations: Array<{
      id: string;
      summary: string;
      isActive: boolean;
      messageCount: number;
    }> = [];

    // 1. Mover msgs antiguos no enviados a la IA → conv histórica
    const remaining = await this.messageRepository.findRemainingUnanalyzed(
      conversationId,
      batchMessageIds,
    );

    const remainingIds = remaining.map((m) => m.id);

    if (remainingIds.length > 0) {
      const result = await this.archiveMessages(
        phoneId, clientId, remainingIds,
        'Mensajes históricos anteriores al análisis',
      );
      createdConversations.push({
        id: result.subConversationId,
        summary: 'Mensajes históricos anteriores al análisis',
        isActive: false,
        messageCount: result.messageCount,
      });
    }

    // 2. Si hay huérfanos del batch (msgs antes del primer split)
    if (orphanMessageIds.length > 0) {
      const result = await this.archiveMessages(
        phoneId, clientId, orphanMessageIds,
        'Mensajes anteriores sin clasificar',
      );
      createdConversations.push({
        id: result.subConversationId,
        summary: 'Mensajes anteriores sin clasificar',
        isActive: false,
        messageCount: result.messageCount,
      });
    }

    // 3. Crear sub-conversaciones de la IA
    for (const split of splits) {
      let subConvId: string;
      let messageCount: number;

      if (split.messageIds.length > 0) {
        const result = await this.archiveMessages(
          phoneId, clientId, split.messageIds, split.summary,
        );
        subConvId = result.subConversationId;
        messageCount = result.messageCount;
      } else {
        const subConv = await this.conversationRepository.createWithParticipant({
          phoneId, clientId, summary: split.summary, isActive: false,
        });
        subConvId = subConv.id;
        messageCount = 0;
      }

      if (split.intent || split.flowDiagram || split.flowSummary) {
        await this.conversationAnalysisRepo.upsert({
          conversationId: subConvId,
          intent: split.intent ?? null,
          flowDiagram: split.flowDiagram ?? null,
          flowSummary: split.flowSummary ?? null,
        });
      }

      createdConversations.push({
        id: subConvId,
        summary: split.summary,
        isActive: false,
        messageCount,
      });
    }

    return { createdConversations };
  }

  @Post('close-conversation')
  async closeConversation(@Body() body: { conversationId: string }) {
    const { conversationId } = body;

    const conversation = await this.conversationRepository.findByIdWithRelations(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    if (!conversation.client) {
      throw new Error(`Cannot resolve client for conversation ${conversationId}`);
    }

    const messages = await this.messageRepository.findByConversationId(conversationId);
    if (messages.length === 0) {
      return { closed: true, movedMessages: 0 };
    }

    const messageIds = messages.map((m) => m.id);
    const result = await this.archiveMessages(
      conversation.phoneId,
      conversation.client.id,
      messageIds,
    );

    return { closed: true, movedMessages: result.messageCount, subConversationId: result.subConversationId };
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.messageRepository.findById(id);
  }

  @Patch('clients/:id/name')
  async updateClientName(
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.clientRepository.updateName(id, name);
  }

  /**
   * Crea sub-conversación (isActive: false), mueve mensajes ahí, y los marca como analizados.
   */
  private async archiveMessages(
    phoneId: string,
    clientId: string,
    messageIds: string[],
    summary?: string,
  ): Promise<{ subConversationId: string; messageCount: number }> {
    const subConv = await this.conversationRepository.createWithParticipant({
      phoneId,
      clientId,
      summary,
      isActive: false,
    });

    await this.messageRepository.updateConversationId(messageIds, subConv.id);
    await this.messageRepository.markAsAnalyzed(messageIds);

    return { subConversationId: subConv.id, messageCount: messageIds.length };
  }
}
