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

@Controller('internal/messages')
@UseGuards(InternalGuard)
export class InternalWebhooksController {
  constructor(private readonly messageRepository: MessageRepository) {}

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
}
