import { Module } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service';
import { AiWorkflow } from './langgraph/workflow';
import { InputRouterNode } from './langgraph/nodes/input-router.node';
import { IntentRouterNode } from './langgraph/nodes/intent-router.node';
import { CustomNode } from './langgraph/nodes/custom-node.node';
import { OutputRouterNode } from './langgraph/nodes/output-router.node';
import { FinalizeNode } from './langgraph/nodes/finalize.node';
import { EntryCheckerNode } from './langgraph/nodes/entry-checker.node';
import { FlowRouterNode } from './langgraph/nodes/flow-router.node';
import { ExternalIntegrationsModule } from '@common/external-integrations/external-integrations.module';
import { ConversationSessionModule } from '@common/conversation-session/conversation-session.module';
import { AiRepository } from './repositories/ai.repository';
import { TestSessionService } from './test-session.service';
import { FlowTestController } from './flow-test.controller';
import { PrismaModule } from '@common/prisma/prisma.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { LimitsModule } from '@common/services/limits.module';
import { NodesModule } from '@modules/nodes/nodes.module';
import { PhonesModule } from '@modules/phones/phones.module';
import { RedisModule } from '@common/redis/redis.module';
import { ImageModule } from '@common/image/image.module';

@Module({
  imports: [
    PrismaModule,
    EvolutionModule,
    WebSocketModule,
    LimitsModule,
    RedisModule,
    ImageModule,
    ExternalIntegrationsModule,
    ConversationSessionModule,
    PhonesModule,
    NodesModule,
  ],
  controllers: [FlowTestController],
  providers: [
    AiAgentService,
    AiWorkflow,
    InputRouterNode,
    IntentRouterNode,
    CustomNode,
    OutputRouterNode,
    FinalizeNode,
    EntryCheckerNode,
    FlowRouterNode,
    AiRepository,
    TestSessionService,
  ],
  exports: [
    ExternalIntegrationsModule,
    ConversationSessionModule,
    AiWorkflow,
  ],
})
export class ConversationOrchestrationModule {}
