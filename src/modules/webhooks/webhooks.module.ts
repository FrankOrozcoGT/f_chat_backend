import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PhoneRepository } from '../phones/repositories/phone.repository';
import { ClientRepository } from './repositories/client.repository';
import { MessageRepository } from './repositories/message.repository';

@Module({
  imports: [PrismaModule, WebSocketModule, ConversationsModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    PhoneRepository,
    ClientRepository,
    MessageRepository,
  ],
})
export class WebhooksModule {}
