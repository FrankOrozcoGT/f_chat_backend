import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { InternalConversationsService } from './internal-conversations.service';

@Controller('internal/conversations')
@UseGuards(InternalGuard)
export class InternalConversationsController {
  constructor(private readonly internalConversationsService: InternalConversationsService) {}

  @Get(':id')
  async getConversation(@Param('id') id: string) {
    return this.internalConversationsService.getConversation(id);
  }

  @Get(':id/full')
  async getConversationFull(@Param('id') id: string) {
    return this.internalConversationsService.getConversationFull(id);
  }

  @Patch(':id/mode')
  async updateMode(
    @Param('id') id: string,
    @Body('mode') mode: 'AI' | 'HITL',
  ) {
    await this.internalConversationsService.updateMode(id, mode);
  }

  @Patch(':id/summary')
  async updateSummary(
    @Param('id') id: string,
    @Body('summary') summary: string,
  ) {
    return this.internalConversationsService.updateSummary(id, summary);
  }

  @Post('create-with-participant')
  async createWithParticipant(
    @Body() body: {
      phoneId: string;
      clientId: string;
      summary?: string;
      isActive: boolean;
    },
  ) {
    return this.internalConversationsService.createWithParticipant(body);
  }
}
