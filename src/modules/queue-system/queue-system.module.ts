import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { UserSettingsModule } from '@modules/user-settings/user-settings.module';
import { NodesModule } from '@modules/nodes/nodes.module';
import { ContactLabelRepository } from './repositories/contact-label.repository';
import { QueueRequestRepository } from './repositories/queue-request.repository';
import { ContactLabelService } from './services/contact-label.service';
import { QueueRequestService } from './services/queue-request.service';
import { QueueResumeService } from './services/queue-resume.service';
import { UserQueueManager } from './services/user-queue-manager.service';
import { QueueSchedulerService } from './services/queue-scheduler.service';

@Module({
  imports: [
    PrismaModule,
    EvolutionModule,
    UserSettingsModule,
    forwardRef(() => NodesModule),
  ],
  providers: [
    ContactLabelRepository,
    QueueRequestRepository,
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
