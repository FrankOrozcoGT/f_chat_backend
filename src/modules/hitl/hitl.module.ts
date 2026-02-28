import { Module } from '@nestjs/common';
import { HitlController } from './hitl.controller';
import { HitlService } from './hitl.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { SessionRepository } from '@modules/ai/repositories/session.repository';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';

@Module({
  imports: [PrismaModule, ConversationsModule, WebSocketModule],
  controllers: [HitlController],
  providers: [
    HitlService,
    SessionRepository,
    MessageRepository,
    PhoneRepository,
  ],
})
export class HitlModule {}
