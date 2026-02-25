import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { ClientRepository } from '@modules/webhooks/repositories/client.repository';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { PhonesModule } from '@modules/phones/phones.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { FileStorageModule } from '@common/file-storage/file-storage.module';

@Module({
  imports: [
    PrismaModule,
    ConversationsModule,
    PhonesModule,
    EvolutionModule,
    WebSocketModule,
    FileStorageModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService, MessageRepository, ClientRepository],
  exports: [MessagesService, MessageRepository],
})
export class MessagesModule {}
