import { Module, forwardRef } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { AiModule } from '../ai/ai.module';
import { NodeRepository } from './repositories/node.repository';
import { NodeSessionRepository } from './repositories/node-session.repository';
import { IntentRepository } from './repositories/intent.repository';
import { NodeRunnerService } from './services/node-runner.service';
import { NodeFunctionRegistry } from './functions/node-function.registry';
import { LoadIntentsFn } from './functions/implementations/load-intents.fn';
import { FindFlowForIntentFn } from './functions/implementations/find-flow-for-intent.fn';
import { CloseSessionFn } from './functions/implementations/close-session.fn';
import { SwitchToHitlFn } from './functions/implementations/switch-to-hitl.fn';
import { ResponderFn } from './functions/implementations/responder.fn';
import { ReportHackingFn } from './functions/implementations/report-hacking.fn';
import { MoveToLastConversationFn } from './functions/implementations/move-to-last-conversation.fn';
import { LoadClientProductsFn } from './functions/implementations/load-client-products.fn';
import { SearchProductFn } from './functions/implementations/search-product.fn';
import { CheckPromotionsFn } from './functions/implementations/check-promotions.fn';
import { CalculateShippingFn } from './functions/implementations/calculate-shipping.fn';
import { ConfirmSaleFn } from './functions/implementations/confirm-sale.fn';
import { MoveToNegotiationFn } from './functions/implementations/move-to-negotiation.fn';
import { SalesRejectionFn } from './functions/implementations/sales-rejection.fn';
import { RegisterMissingProductFn } from './functions/implementations/register-missing-product.fn';
import { SaveClientLocationFn } from './functions/implementations/save-client-location.fn';
import { SaveProductPriceFn } from './functions/implementations/save-product-price.fn';
import { SecurityEventRepository } from './repositories/security-event.repository';
import { TemplateRepository } from './repositories/template.repository';
import { TestSessionService } from './services/test-session.service';
import { NodesController } from './nodes.controller';
import { PhonesModule } from '@modules/phones/phones.module';
import { QueueSystemModule } from '@modules/queue-system/queue-system.module';

@Module({
  imports: [DiscoveryModule, EvolutionModule, forwardRef(() => AiModule), PhonesModule, forwardRef(() => QueueSystemModule)],
  controllers: [NodesController],
  providers: [
    NodeRepository,
    NodeSessionRepository,
    IntentRepository,
    NodeRunnerService,
    NodeFunctionRegistry,
    LoadIntentsFn,
    FindFlowForIntentFn,
    CloseSessionFn,
    SwitchToHitlFn,
    ResponderFn,
    ReportHackingFn,
    MoveToLastConversationFn,
    LoadClientProductsFn,
    SearchProductFn,
    CheckPromotionsFn,
    CalculateShippingFn,
    ConfirmSaleFn,
    MoveToNegotiationFn,
    SalesRejectionFn,
    RegisterMissingProductFn,
    SaveClientLocationFn,
    SaveProductPriceFn,
    SecurityEventRepository,
    TemplateRepository,
    TestSessionService,
  ],
  exports: [NodeRepository, NodeSessionRepository, IntentRepository, NodeRunnerService, NodeFunctionRegistry],
})
export class NodesModule {}
