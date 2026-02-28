import { Module } from '@nestjs/common';
import { AiModule } from '@modules/ai/ai.module';
import { LimitsModule } from '@common/services/limits.module';
import { FileStorageModule } from '@common/file-storage/file-storage.module';
import { ConversationAnalysisController } from './conversation-analysis.controller';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { AnalysisWorkflow } from './langgraph/analysis-workflow';
import { AnalysisInputRouterNode } from './langgraph/nodes/input-router.node';
import { AnalysisNode } from './langgraph/nodes/analysis.node';

@Module({
  imports: [
    AiModule,
    LimitsModule,
    FileStorageModule,
  ],
  controllers: [ConversationAnalysisController],
  providers: [
    ConversationAnalysisService,
    AnalysisWorkflow,
    AnalysisInputRouterNode,
    AnalysisNode,
  ],
})
export class ConversationAnalysisModule {}
