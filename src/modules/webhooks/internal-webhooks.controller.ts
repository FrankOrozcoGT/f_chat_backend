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
import { InternalMessagesService } from './internal-messages.service';
import { MessageType, MessageDirection, MessageSenderType, MessageStatus, Prisma } from '@prisma/client';

@Controller('internal/messages')
@UseGuards(InternalGuard)
export class InternalWebhooksController {
  constructor(private readonly internalMessagesService: InternalMessagesService) {}

  @Post('send-transaction')
  async sendMessageTransaction(
    @Body()
    body: {
      conversationId: string;
      userId: string;
      messageData: {
        type: MessageType;
        content: string;
        mediaUrl: string | null;
        fileName?: string | null;
        fileSize?: number | null;
        mimeType?: string | null;
        direction: MessageDirection;
        senderType: MessageSenderType;
        status: MessageStatus;
        metadata?: Prisma.InputJsonValue;
      };
      conversationUpdate: { lastMessageAt: string; lastMessagePreview: string };
    },
  ) {
    return this.internalMessagesService.sendMessageTransaction(
      body.conversationId,
      body.userId,
      body.messageData,
      body.conversationUpdate,
    );
  }

  @Patch(':id/transcription')
  async updateTranscription(
    @Param('id') id: string,
    @Body('transcription') transcription: string,
  ) {
    await this.internalMessagesService.updateTranscription(id, transcription);
  }

  @Get('history/:conversationId')
  async getHistory(
    @Param('conversationId') conversationId: string,
    @Query('take') take?: string,
  ) {
    return this.internalMessagesService.getHistory(conversationId, take);
  }

  @Get('unanalyzed/:conversationId')
  async findLastNUnanalyzed(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
  ) {
    return this.internalMessagesService.findLastNUnanalyzed(conversationId, limit);
  }

  @Post('mark-analyzed')
  async markAsAnalyzed(@Body('messageIds') messageIds: string[]) {
    return this.internalMessagesService.markAsAnalyzed(messageIds);
  }

  @Post('move-to-conversation')
  async updateConversationId(
    @Body() body: { messageIds: string[]; newConversationId?: string },
  ) {
    return this.internalMessagesService.updateConversationId(body.messageIds, body.newConversationId);
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
      splits: Array<{ summary: string; messageIds: string[]; intent?: string | null; intentDescription?: string | null; flowDiagram?: string | null; flowSummary?: string | null }>;
      orphanMessageIds: string[];
    },
  ) {
    return this.internalMessagesService.processAnalysisSplits(
      body.conversationId,
      body.phoneId,
      body.clientId,
      body.batchMessageIds,
      body.splits,
      body.orphanMessageIds,
    );
  }

  @Post('close-conversation')
  async closeConversation(@Body() body: { conversationId: string }) {
    return this.internalMessagesService.closeConversation(body.conversationId);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.internalMessagesService.findById(id);
  }

  @Patch('clients/:id/name')
  async updateClientName(
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.internalMessagesService.updateClientName(id, name);
  }
}
