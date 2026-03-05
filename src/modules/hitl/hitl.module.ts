import { Module } from '@nestjs/common';
import { HitlController } from './hitl.controller';
import { HitlService } from './hitl.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { AiModule } from '@modules/ai/ai.module';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';

@Module({
  imports: [PrismaModule, ConversationsModule, AiModule],
  controllers: [HitlController],
  providers: [
    HitlService,
    MessageRepository,
    PhoneRepository,
  ],
})
export class HitlModule {}
