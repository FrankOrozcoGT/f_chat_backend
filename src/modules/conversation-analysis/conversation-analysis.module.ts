import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '@modules/ai/ai.module';
import { LimitsModule } from '@common/services/limits.module';
import { FileStorageModule } from '@common/file-storage/file-storage.module';
import { NodesModule } from '@modules/nodes/nodes.module';
import { ConversationAnalysisController } from './conversation-analysis.controller';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { AnalysisWorkflow } from './langgraph/analysis-workflow';
import { AnalysisInputRouterNode } from './langgraph/nodes/input-router.node';
import { AnalysisNode } from './langgraph/nodes/analysis.node';
import { FlowGeneratorNode } from './langgraph/nodes/flow-generator.node';
import { IntentClassifierNode } from './langgraph/nodes/intent-classifier.node';
import { BatchAnalysisController } from './batch-analysis.controller';
import { BatchAnalysisService } from './batch-analysis.service';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { FlowIntentRepository } from './repositories/flow-intent.repository';

@Module({
  imports: [
    AiModule,
    LimitsModule,
    FileStorageModule,
    forwardRef(() => NodesModule),
  ],
  controllers: [ConversationAnalysisController, BatchAnalysisController],
  providers: [
    ConversationAnalysisService,
    AnalysisWorkflow,
    AnalysisInputRouterNode,
    AnalysisNode,
    FlowGeneratorNode,
    IntentClassifierNode,
    BatchAnalysisService,
    ClientLabelRepository,
    ConversationAnalysisRepository,
    FlowIntentRepository,
  ],
  exports: [AnalysisWorkflow, ConversationAnalysisService],
})
export class ConversationAnalysisModule {}
