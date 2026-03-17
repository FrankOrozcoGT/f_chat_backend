import {
  Controller,
  Post,
  Param,
  UseGuards,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { LimitsService } from '@common/services/limits.service';
import { InternalApiClient } from '@modules/ai/clients/internal-api.client';
import { AnalysisWorkflow } from './langgraph/analysis-workflow';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { AnalyzeResponseDto } from './dto/analyze-response.dto';
import { AnalysisMessage } from './langgraph/analysis-state.interface';

@Controller('api/conversations')
@UseGuards(AuthGuard('jwt'))
export class ConversationAnalysisController {
  private readonly logger = new Logger(ConversationAnalysisController.name);

  constructor(
    private readonly internalApi: InternalApiClient,
    private readonly limitsService: LimitsService,
    private readonly analysisWorkflow: AnalysisWorkflow,
    private readonly analysisService: ConversationAnalysisService,
  ) {}

  @Post(':id/analyze')
  @HttpCode(200)
  async analyze(
    @Param('id') conversationId: string,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<AnalyzeResponseDto> {
    // 1. Obtener conversación completa
    const conversation =
      await this.internalApi.getConversationFull(conversationId);

    // 2. Validar ownership
    this.analysisService.validateOwnership(
      conversation.phone.tenantId,
      user.tenantId,
    );

    // 3. Obtener messageLimit del tenant
    const settings = await this.internalApi.getTenantSettings(user.tenantId);

    // 4. Validar créditos
    await this.limitsService.validateCredits(user.tenantId, 1);

    // 5. Obtener últimos N mensajes no analizados
    const rawMessages = await this.internalApi.findLastNUnanalyzed(
      conversationId,
      settings.messageLimit,
    );

    if (rawMessages.length === 0) {
      return new AnalyzeResponseDto({
        conversations: [],
        creditsUsed: 0,
        warnings: [
          {
            messageId: '',
            type: 'no_messages',
            message: 'No hay mensajes nuevos por analizar',
          },
        ],
      });
    }

    // 6. Mapear mensajes
    const messages: AnalysisMessage[] = rawMessages.map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      direction: m.direction,
      senderType: m.senderType,
      transcription: m.transcription,
      mediaUrl: m.mediaUrl,
      createdAt: m.createdAt,
    }));

    const clientId = conversation.client?.id ?? null;

    // 7. Ejecutar workflow LangGraph
    const result = await this.analysisWorkflow.execute({
      conversationId,
      tenantId: user.tenantId,
      phoneId: conversation.phoneId,
      clientId,
      messages,
    });

    // 8. Procesar splits: mover msgs antiguos, crear sub-convs, marcar analizados
    if (!clientId) {
      throw new Error(
        `Cannot create sub-conversations: no clientId for conversation ${conversationId}`,
      );
    }

    const splits = this.analysisService.buildSplits(
      result.subConversations,
      messages,
    );
    const orphanMessageIds = this.analysisService.findOrphanPrefix(
      splits,
      messages,
    );
    const batchMessageIds = messages.map((m) => m.id);

    const { createdConversations } =
      await this.internalApi.processAnalysisSplits({
        conversationId,
        phoneId: conversation.phoneId,
        clientId,
        batchMessageIds,
        splits,
        orphanMessageIds,
      });

    // 9. Procesar catálogo: productos, descuentos, promociones
    await this.internalApi.processAnalysisCatalog({
      tenantId: user.tenantId,
      clientId,
      products: result.products,
      promotions: result.promotions,
    });

    // 10. Guardar realName en Client
    if (result.realName && clientId) {
      await this.internalApi.updateClientName(clientId, result.realName);
    }

    this.logger.log(
      `Analysis completed for conversation ${conversationId}: ${createdConversations.length} sub-conversations, cost=$${result.totalCost.toFixed(6)}`,
    );

    return new AnalyzeResponseDto({
      conversations: createdConversations,
      creditsUsed: result.totalCost,
      warnings: result.warnings,
    });
  }
}
