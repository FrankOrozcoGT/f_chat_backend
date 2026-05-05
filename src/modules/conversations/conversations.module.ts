import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { InternalConversationsController } from './internal-conversations.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationRepository } from './repositories/conversation.repository';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { NodesModule } from '@modules/nodes/nodes.module';
import { QueueSystemModule } from '@modules/queue-system/queue-system.module';

@Module({
  imports: [PrismaModule, EvolutionModule, CatalogModule, NodesModule, QueueSystemModule],
  controllers: [ConversationsController, InternalConversationsController],
  providers: [ConversationsService, ConversationRepository],
  exports: [ConversationRepository],
})
export class ConversationsModule {}
