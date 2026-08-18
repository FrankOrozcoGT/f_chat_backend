import {
  Controller,
  Post,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { AnalyzeResponseDto } from './dto/analyze-response.dto';

@Controller('api/conversations')
@UseGuards(AuthGuard('jwt'))
export class ConversationAnalysisController {
  constructor(
    private readonly internalApi: InternalApiClient,
    private readonly analysisService: ConversationAnalysisService,
  ) {}

  @Post(':id/analyze')
  @HttpCode(200)
  async analyze(
    @Param('id') conversationId: string,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<AnalyzeResponseDto> {
    const conversation = await this.internalApi.getConversationFull(conversationId);

    this.analysisService.validateOwnership(conversation.phone.tenantId, user.tenantId);

    const result = await this.analysisService.runAnalysis(conversation, user.tenantId);

    return new AnalyzeResponseDto({
      conversations: result.createdConversations,
      creditsUsed: result.creditsUsed,
      warnings: result.warnings,
    });
  }
}
