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

@Controller('internal/messages')
@UseGuards(InternalGuard)
export class InternalWebhooksController {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
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
      content: m.content,
      direction: m.direction,
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
    @Body() body: { messageIds: string[]; newConversationId: string },
  ) {
    return this.messageRepository.updateConversationId(
      body.messageIds,
      body.newConversationId,
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
      splits: Array<{ summary: string; messageIds: string[] }>;
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

    // 1. Mover msgs antiguos no enviados a la IA → conv histórica isActive: false
    const remaining = await this.messageRepository.findRemainingUnanalyzed(
      conversationId,
      batchMessageIds,
    );

    const remainingIds = remaining.map((m) => m.id);

    if (remainingIds.length > 0) {
      const historicalConv =
        await this.conversationRepository.createWithParticipant({
          phoneId,
          clientId,
          summary: 'Mensajes históricos anteriores al análisis',
          isActive: false,
        });

      await this.messageRepository.updateConversationId(
        remainingIds,
        historicalConv.id,
      );
      await this.messageRepository.markAsAnalyzed(remainingIds);

      createdConversations.push({
        id: historicalConv.id,
        summary: 'Mensajes históricos anteriores al análisis',
        isActive: false,
        messageCount: remainingIds.length,
      });
    }

    // 2. Si hay huérfanos del batch (msgs antes del primer split), crear conv
    if (orphanMessageIds.length > 0) {
      const orphanConv =
        await this.conversationRepository.createWithParticipant({
          phoneId,
          clientId,
          summary: 'Mensajes anteriores sin clasificar',
          isActive: false,
        });

      await this.messageRepository.updateConversationId(
        orphanMessageIds,
        orphanConv.id,
      );

      createdConversations.push({
        id: orphanConv.id,
        summary: 'Mensajes anteriores sin clasificar',
        isActive: false,
        messageCount: orphanMessageIds.length,
      });
    }

    // 3. Crear sub-conversaciones de la IA
    for (const split of splits) {
      const newConv =
        await this.conversationRepository.createWithParticipant({
          phoneId,
          clientId,
          summary: split.summary,
          isActive: false,
        });

      if (split.messageIds.length > 0) {
        await this.messageRepository.updateConversationId(
          split.messageIds,
          newConv.id,
        );
      }

      createdConversations.push({
        id: newConv.id,
        summary: split.summary,
        isActive: false,
        messageCount: split.messageIds.length,
      });
    }

    // 4. Marcar como analizados: huérfanos + clasificados por la IA
    const processedIds = [
      ...orphanMessageIds,
      ...splits.flatMap((s) => s.messageIds),
    ];
    if (processedIds.length > 0) {
      await this.messageRepository.markAsAnalyzed(processedIds);
    }

    return { createdConversations };
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
}
