import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationRepository } from './repositories/conversation.repository';
import { PhonesModule } from '@modules/phones/phones.module';
import { ClientRepository } from '@modules/webhooks/repositories/client.repository';

@Module({
  imports: [PrismaModule, PhonesModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationRepository, ClientRepository],
  exports: [ConversationRepository],
})
export class ConversationsModule {}
