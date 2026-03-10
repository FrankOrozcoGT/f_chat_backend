import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '@common/prisma/prisma.module';
import { FileStorageModule } from '@common/file-storage/file-storage.module';
import { UsersModule } from '@modules/users/users.module';
import { AuthModule } from '@modules/auth/auth.module';
import { HealthModule } from '@modules/health/health.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { PhonesModule } from '@modules/phones/phones.module';
import { WebhooksModule } from '@modules/webhooks/webhooks.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { LangSmithModule } from '@common/langsmith/langsmith.module';
import { RedisModule } from '@common/redis/redis.module';
import { AiModule } from '@modules/ai/ai.module';
import { HitlModule } from '@modules/hitl/hitl.module';
import { AdminModule } from '@modules/admin/admin.module';
import { UserSettingsModule } from '@modules/user-settings/user-settings.module';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { ConversationAnalysisModule } from '@modules/conversation-analysis/conversation-analysis.module';
import { QueueModule } from '@common/queue/queue.module';
import { NodesModule } from '@modules/nodes/nodes.module';
import { ContactsModule } from '@modules/contacts/contacts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    QueueModule,
    PrismaModule,
    FileStorageModule,
    EvolutionModule,
    WebSocketModule,
    LangSmithModule,
    RedisModule,
    UsersModule,
    AuthModule,
    HealthModule,
    PhonesModule,
    ConversationsModule,
    MessagesModule,
    NodesModule,
    AiModule,
    HitlModule,
    AdminModule,
    UserSettingsModule,
    CatalogModule,
    ConversationAnalysisModule,
    ContactsModule,
    WebhooksModule,
  ],
})
export class AppModule {}
