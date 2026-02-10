import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { ConversationRepository } from './repositories/conversation.repository';
import { ConversationResponseDto } from './dto/conversation-response.dto';

@Controller('api/conversations')
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req,
    @Query('phoneId') phoneId?: string,
  ): Promise<ConversationResponseDto[]> {
    const userId = req.user.id;

    this.logger.log(`GET /api/conversations - userId: ${userId}, phoneId: ${phoneId || 'all'}`);

    // Obtener conversaciones del usuario
    const conversations = await this.conversationRepository.findByUserIdAndPhone(
      userId,
      phoneId,
    );

    // Mapear a DTO
    return conversations.map((conversation) => new ConversationResponseDto(conversation));
  }
}
