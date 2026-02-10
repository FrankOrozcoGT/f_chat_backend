import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { PhonesModule } from '@modules/phones/phones.module';

@Module({
  imports: [PrismaModule, ConversationsModule, PhonesModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessageRepository],
  exports: [MessageRepository],
})
export class MessagesModule {}
