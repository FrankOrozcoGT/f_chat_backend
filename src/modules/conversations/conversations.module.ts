import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { InternalConversationsController } from './internal-conversations.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationRepository } from './repositories/conversation.repository';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { CatalogModule } from '@modules/catalog/catalog.module';

@Module({
  imports: [PrismaModule, EvolutionModule, CatalogModule],
  controllers: [ConversationsController, InternalConversationsController],
  providers: [ConversationsService, ConversationRepository],
  exports: [ConversationRepository],
})
export class ConversationsModule {}
