import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationRepository } from './repositories/conversation.repository';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { ConversationAnalysisModule } from '@modules/conversation-analysis/conversation-analysis.module';

@Module({
  imports: [PrismaModule, EvolutionModule, ConversationAnalysisModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationRepository],
  exports: [ConversationRepository],
})
export class ConversationsModule {}
