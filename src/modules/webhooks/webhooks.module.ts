import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { FileStorageModule } from '@common/file-storage/file-storage.module';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from './repositories/client.repository';
import { MessageRepository } from './repositories/message.repository';
import { GroupConversationRepository } from './repositories/group-conversation.repository';

@Module({
  imports: [
    PrismaModule,
    WebSocketModule,
    ConversationsModule,
    EvolutionModule,
    FileStorageModule,
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    PhoneRepository,
    ClientRepository,
    MessageRepository,
    GroupConversationRepository,
  ],
})
export class WebhooksModule {}
