import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { InternalWebhooksController } from './internal-webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { FileStorageModule } from '@common/file-storage/file-storage.module';
import { QueueSystemModule } from '@modules/queue-system/queue-system.module';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from './repositories/client.repository';
import { MessageRepository } from './repositories/message.repository';
import { GroupConversationRepository } from './repositories/group-conversation.repository';
import { PhoneQueueService } from './services/phone-queue.service';
import { WebhookProcessorService } from './services/webhook-processor.service';
import { PhoneQueueProcessor } from './processors/phone-queue.processor';

@Module({
  imports: [
    PrismaModule,
    WebSocketModule,
    ConversationsModule,
    EvolutionModule,
    FileStorageModule,
    QueueSystemModule,
  ],
  controllers: [WebhooksController, InternalWebhooksController],
  providers: [
    WebhooksService,
    PhoneRepository,
    ClientRepository,
    MessageRepository,
    GroupConversationRepository,
    PhoneQueueService,
    WebhookProcessorService,
    PhoneQueueProcessor,
  ],
})
export class WebhooksModule {}
