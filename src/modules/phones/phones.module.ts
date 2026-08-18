import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { LimitsModule } from '@common/services/limits.module';
import { UsersModule } from '@modules/users/users.module';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { PhonesController } from '@modules/phones/phones.controller';
import { PhonesService } from '@modules/phones/phones.service';
import { ClientRepository } from '@common/messaging/repositories/client.repository';
import { MessageRepository } from '@common/messaging/repositories/message.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [
    EvolutionModule,
    ConfigModule,
    LimitsModule,
    UsersModule,
    PrismaModule,
  ],
  controllers: [PhonesController],
  providers: [
    PhoneRepository,
    PhonesService,
    ClientRepository,
    MessageRepository,
    ConversationRepository,
  ],
  exports: [PhoneRepository],
})
export class PhonesModule {}
