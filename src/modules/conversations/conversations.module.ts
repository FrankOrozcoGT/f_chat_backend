import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationRepository } from './repositories/conversation.repository';
import { PhonesModule } from '@modules/phones/phones.module';
import { ClientRepository } from '@modules/webhooks/repositories/client.repository';
import { EvolutionModule } from '@common/evolution/evolution.module';

@Module({
  imports: [PrismaModule, PhonesModule, EvolutionModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationRepository, ClientRepository],
  exports: [ConversationRepository],
})
export class ConversationsModule {}
