import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@common/prisma/prisma.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { UserSettingsModule } from '@modules/user-settings/user-settings.module';
import { NodesModule } from '@modules/nodes/nodes.module';
import { ContactLabelRepository } from './repositories/contact-label.repository';
import { QueueRequestRepository } from './repositories/queue-request.repository';
import { ContactLabelService } from './services/contact-label.service';
import { WorkScheduleService } from './services/work-schedule.service';
import { QueueRequestService } from './services/queue-request.service';
import { OutboundQueueProcessor } from './processors/outbound-queue.processor';
import { QueueResumeService } from './services/queue-resume.service';

@Module({
  imports: [
    PrismaModule,
    EvolutionModule,
    UserSettingsModule,
    forwardRef(() => NodesModule),
    BullModule.registerQueue({ name: 'outbound-queue' }),
  ],
  providers: [
    ContactLabelRepository,
    QueueRequestRepository,
    ContactLabelService,
    WorkScheduleService,
    QueueRequestService,
    OutboundQueueProcessor,
    QueueResumeService,
  ],
  exports: [
    ContactLabelService,
    QueueRequestService,
    QueueRequestRepository,
  ],
})
export class QueueSystemModule {}
