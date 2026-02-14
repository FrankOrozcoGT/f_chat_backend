import { Module } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service';
import { AiWorkflow } from './langgraph/workflow';
import { InputRouterNode } from './langgraph/nodes/input-router.node';
import { LlmNode } from './langgraph/nodes/llm.node';
import { OutputRouterNode } from './langgraph/nodes/output-router.node';
import { SendNode } from './langgraph/nodes/send.node';
import { QwenSttClient } from './clients/qwen-stt.client';
import { KimiClient } from './clients/kimi.client';
import { QwenTtsClient } from './clients/qwen-tts.client';
import { AiRepository } from './repositories/ai.repository';
import { PrismaModule } from '@common/prisma/prisma.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';

@Module({
  imports: [PrismaModule, MessagesModule, ConversationsModule],
  providers: [
    AiAgentService,
    AiWorkflow,
    InputRouterNode,
    LlmNode,
    OutputRouterNode,
    SendNode,
    QwenSttClient,
    KimiClient,
    QwenTtsClient,
    AiRepository,
  ],
})
export class AiModule {}
