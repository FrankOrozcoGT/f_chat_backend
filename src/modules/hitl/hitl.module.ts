import { Module } from '@nestjs/common';
import { HitlController } from './hitl.controller';
import { HitlService } from './hitl.service';
import { HitlReturnListener } from './hitl-return.listener';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { AiModule } from '@modules/ai/ai.module';
import { ConversationAnalysisModule } from '@modules/conversation-analysis/conversation-analysis.module';
import { NodesModule } from '@modules/nodes/nodes.module';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';

@Module({
  imports: [PrismaModule, ConversationsModule, AiModule, ConversationAnalysisModule, NodesModule],
  controllers: [HitlController],
  providers: [
    HitlService,
    HitlReturnListener,
    MessageRepository,
    PhoneRepository,
  ],
})
export class HitlModule {}
