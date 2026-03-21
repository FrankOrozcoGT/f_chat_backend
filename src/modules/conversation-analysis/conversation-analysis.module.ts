import { Module } from '@nestjs/common';
import { AiModule } from '@modules/ai/ai.module';
import { LimitsModule } from '@common/services/limits.module';
import { FileStorageModule } from '@common/file-storage/file-storage.module';
import { ConversationAnalysisController } from './conversation-analysis.controller';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { AnalysisWorkflow } from './langgraph/analysis-workflow';
import { AnalysisInputRouterNode } from './langgraph/nodes/input-router.node';
import { AnalysisNode } from './langgraph/nodes/analysis.node';
import { BatchAnalysisController } from './batch-analysis.controller';
import { BatchAnalysisService } from './batch-analysis.service';
import { ClientLabelRepository } from './repositories/client-label.repository';

@Module({
  imports: [
    AiModule,
    LimitsModule,
    FileStorageModule,
  ],
  controllers: [ConversationAnalysisController, BatchAnalysisController],
  providers: [
    ConversationAnalysisService,
    AnalysisWorkflow,
    AnalysisInputRouterNode,
    AnalysisNode,
    BatchAnalysisService,
    ClientLabelRepository,
  ],
  exports: [AnalysisWorkflow, ConversationAnalysisService],
})
export class ConversationAnalysisModule {}
