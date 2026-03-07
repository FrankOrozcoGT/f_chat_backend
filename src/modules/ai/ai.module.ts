import { Module, forwardRef } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service';
import { AiWorkflow } from './langgraph/workflow';
import { InputRouterNode } from './langgraph/nodes/input-router.node';
import { LlmNode } from './langgraph/nodes/llm.node';
import { OutputRouterNode } from './langgraph/nodes/output-router.node';
import { FinalizeNode } from './langgraph/nodes/finalize.node';
import { QwenSttClient } from './clients/qwen-stt.client';
import { KimiClient } from './clients/kimi.client';
import { QwenTtsClient } from './clients/qwen-tts.client';
import { InternalApiClient } from './clients/internal-api.client';
import { AiRepository } from './repositories/ai.repository';
import { SessionRepository } from './repositories/session.repository';
import { SessionLifecycleService } from './services/session-lifecycle.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { LimitsModule } from '@common/services/limits.module';
import { NodesModule } from '../nodes/nodes.module';

@Module({
  imports: [
    PrismaModule,
    EvolutionModule,
    WebSocketModule,
    LimitsModule,
    forwardRef(() => NodesModule),
  ],
  providers: [
    AiAgentService,
    AiWorkflow,
    InputRouterNode,
    LlmNode,
    OutputRouterNode,
    FinalizeNode,
    QwenSttClient,
    KimiClient,
    QwenTtsClient,
    InternalApiClient,
    AiRepository,
    SessionRepository,
    SessionLifecycleService,
  ],
  exports: [
    InternalApiClient,
    KimiClient,
    QwenSttClient,
    SessionLifecycleService,
  ],
})
export class AiModule {}
