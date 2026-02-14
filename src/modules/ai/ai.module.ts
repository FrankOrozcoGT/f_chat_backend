import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiAgentService } from './ai-agent.service';
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
    AiService,
    AiAgentService,
    QwenSttClient,
    KimiClient,
    QwenTtsClient,
    AiRepository,
  ],
})
export class AiModule {}
