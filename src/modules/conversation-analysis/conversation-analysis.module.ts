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
import { DiagramConsolidatorNode } from './langgraph/nodes/diagram-consolidator.node';
import { NodeContentGeneratorNode } from './langgraph/nodes/node-content-generator.node';
import { IntentSplitterNode } from './langgraph/nodes/intent-splitter.node';
import { MermaidParserModule } from '@modules/nodes/mermaid-parser/mermaid-parser.module';
import { BatchAnalysisController } from './batch-analysis.controller';
import { BatchAnalysisService } from './batch-analysis.service';
import { ClientLabelRepository } from './repositories/client-label.repository';
import { InternalChannelReviewRepository } from './repositories/internal-channel-review.repository';
import { ConversationAnalysisRepository } from './repositories/conversation-analysis.repository';
import { FlowIntentRepository } from './repositories/flow-intent.repository';

@Module({
  imports: [
    AiModule,
    LimitsModule,
    FileStorageModule,
    MermaidParserModule,
    forwardRef(() => NodesModule),
  ],
  controllers: [ConversationAnalysisController, BatchAnalysisController],
  providers: [
    ConversationAnalysisService,
    AnalysisWorkflow,
    AnalysisInputRouterNode,
    AnalysisNode,
    FlowGeneratorNode,
    NodeContentGeneratorNode,
    IntentSplitterNode,
    DiagramConsolidatorNode,
    BatchAnalysisService,
    ClientLabelRepository,
    InternalChannelReviewRepository,
    ConversationAnalysisRepository,
    FlowIntentRepository,
  ],
  exports: [AnalysisWorkflow, ConversationAnalysisService],
})
export class ConversationAnalysisModule {}
