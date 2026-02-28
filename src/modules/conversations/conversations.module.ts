import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationRepository } from './repositories/conversation.repository';
import { EvolutionModule } from '@common/evolution/evolution.module';

@Module({
  imports: [PrismaModule, EvolutionModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationRepository],
  exports: [ConversationRepository],
})
export class ConversationsModule {}
