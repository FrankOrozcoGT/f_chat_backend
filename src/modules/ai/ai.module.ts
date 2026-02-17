import { Module } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service';
import { AiWorkflow } from './langgraph/workflow';
import { InputRouterNode } from './langgraph/nodes/input-router.node';
import { FlowAnalyzerNode } from './langgraph/nodes/flow-analyzer.node';
import { ContextBuilderNode } from './langgraph/nodes/context-builder.node';
import { LlmNode } from './langgraph/nodes/llm.node';
import { OutputRouterNode } from './langgraph/nodes/output-router.node';
import { SendNode } from './langgraph/nodes/send.node';
import { QwenSttClient } from './clients/qwen-stt.client';
import { KimiClient } from './clients/kimi.client';
import { QwenTtsClient } from './clients/qwen-tts.client';
import { AiRepository } from './repositories/ai.repository';
import { SessionRepository } from './repositories/session.repository';
import { ClientMemoryRepository } from './repositories/client-memory.repository';
import { FlowCacheService } from './services/flow-cache.service';
import { NodeMessageService } from './services/node-message.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { HealthModule } from '@modules/health/health.module';
import { LimitsModule } from '@common/services/limits.module';
import { UsersModule } from '@modules/users/users.module';

@Module({
  imports: [PrismaModule, MessagesModule, ConversationsModule, WebSocketModule, HealthModule, LimitsModule, UsersModule],
  providers: [
    AiAgentService,
    AiWorkflow,
    InputRouterNode,
    FlowAnalyzerNode,
    ContextBuilderNode,
    LlmNode,
    OutputRouterNode,
    SendNode,
    QwenSttClient,
    KimiClient,
    QwenTtsClient,
    AiRepository,
    SessionRepository,
    ClientMemoryRepository,
    FlowCacheService,
    NodeMessageService,
  ],
})
export class AiModule {}
