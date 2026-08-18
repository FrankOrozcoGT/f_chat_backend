import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { WebSocketModule } from '@common/websocket/websocket.module';
import { ExternalIntegrationsModule } from '@common/external-integrations/external-integrations.module';
import { SessionRepository } from './session.repository';
import { NodeSessionRepository } from './node-session.repository';
import { SessionLifecycleService } from './session-lifecycle.service';
import { TestQueueResultStore } from './test-queue-result.store';

@Module({
  imports: [PrismaModule, WebSocketModule, ExternalIntegrationsModule],
  providers: [SessionRepository, NodeSessionRepository, SessionLifecycleService, TestQueueResultStore],
  exports: [SessionRepository, NodeSessionRepository, SessionLifecycleService, TestQueueResultStore],
})
export class ConversationSessionModule {}
