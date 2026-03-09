import { Module, forwardRef } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { AiModule } from '../ai/ai.module';
import { NodeRepository } from './repositories/node.repository';
import { NodeSessionRepository } from './repositories/node-session.repository';
import { IntentRepository } from './repositories/intent.repository';
import { DispatcherService } from './services/dispatcher.service';
import { NodeRunnerService } from './services/node-runner.service';
import { NodeFunctionRegistry } from './functions/node-function.registry';
import { LoadIntentsFn } from './functions/implementations/load-intents.fn';
import { FindFlowForIntentFn } from './functions/implementations/find-flow-for-intent.fn';
import { CloseSessionFn } from './functions/implementations/close-session.fn';
import { SwitchToHitlFn } from './functions/implementations/switch-to-hitl.fn';
import { ResponderFn } from './functions/implementations/responder.fn';
import { ReportHackingFn } from './functions/implementations/report-hacking.fn';
import { MoveToLastConversationFn } from './functions/implementations/move-to-last-conversation.fn';
import { SecurityEventRepository } from './repositories/security-event.repository';
import { TemplateRepository } from './repositories/template.repository';
import { TestSessionService } from './services/test-session.service';
import { NodesController } from './nodes.controller';
import { PhonesModule } from '@modules/phones/phones.module';

@Module({
  imports: [DiscoveryModule, EvolutionModule, forwardRef(() => AiModule), PhonesModule],
  controllers: [NodesController],
  providers: [
    NodeRepository,
    NodeSessionRepository,
    IntentRepository,
    DispatcherService,
    NodeRunnerService,
    NodeFunctionRegistry,
    LoadIntentsFn,
    FindFlowForIntentFn,
    CloseSessionFn,
    SwitchToHitlFn,
    ResponderFn,
    ReportHackingFn,
    MoveToLastConversationFn,
    SecurityEventRepository,
    TemplateRepository,
    TestSessionService,
  ],
  exports: [DispatcherService, NodeRepository, NodeSessionRepository, IntentRepository],
})
export class NodesModule {}
