import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@common/prisma/prisma.module';
import { UsersModule } from '@modules/users/users.module';
import { AuthModule } from '@modules/auth/auth.module';
import { HealthModule } from '@modules/health/health.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { PhonesModule } from '@modules/phones/phones.module';
import { WebhooksModule } from '@modules/webhooks/webhooks.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { MessagesModule } from '@modules/messages/messages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    EvolutionModule,
    WebSocketModule,
    UsersModule,
    AuthModule,
    HealthModule,
    PhonesModule,
    ConversationsModule,
    MessagesModule,
    WebhooksModule,
  ],
})
export class AppModule {}
