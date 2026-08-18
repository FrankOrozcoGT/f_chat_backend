import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { ConversationSessionModule } from '@common/conversation-session/conversation-session.module';
import { TenantSettingsRepository } from '@modules/tenant-settings/repositories/tenant-settings.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { ContactLabelRepository } from './repositories/contact-label.repository';
import { QueueRequestRepository } from './repositories/queue-request.repository';
import { QueueSystemController } from './queue-system.controller';
import { ContactLabelService } from './services/contact-label.service';
import { QueueRequestService } from './services/queue-request.service';
import { QueueResumeService } from './services/queue-resume.service';
import { UserQueueManager } from './services/user-queue-manager.service';
import { QueueSchedulerService } from './services/queue-scheduler.service';

@Module({
  imports: [
    PrismaModule,
    EvolutionModule,
    ConversationSessionModule,
  ],
  controllers: [QueueSystemController],
  providers: [
    ContactLabelRepository,
    QueueRequestRepository,
    ConversationRepository,
    TenantSettingsRepository,
    ContactLabelService,
    QueueRequestService,
    QueueResumeService,
    UserQueueManager,
    QueueSchedulerService,
  ],
  exports: [
    ContactLabelService,
    QueueRequestService,
    QueueRequestRepository,
  ],
})
export class QueueSystemModule {}
