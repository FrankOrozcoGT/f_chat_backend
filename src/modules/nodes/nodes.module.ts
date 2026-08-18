import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { ExternalIntegrationsModule } from '@common/external-integrations/external-integrations.module';
import { ConversationSessionModule } from '@common/conversation-session/conversation-session.module';
import { NodeRepository } from './repositories/node.repository';
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
import { CalculateSaleFn } from './functions/implementations/calculate-sale.fn';
import { MoveToNegotiationFn } from './functions/implementations/move-to-negotiation.fn';
import { TransitionToNodeFn } from './functions/implementations/transition-to-node.fn';
import { SalesRejectionFn } from './functions/implementations/sales-rejection.fn';
import { RegisterMissingProductFn } from './functions/implementations/register-missing-product.fn';
import { SaveClientLocationFn } from './functions/implementations/save-client-location.fn';
import { ExitFlowFn } from './functions/implementations/exit-flow.fn';
import { SaveProductPriceFn } from './functions/implementations/save-product-price.fn';
import { SendToInternalChannelFn } from './functions/implementations/send-to-internal-channel.fn';
import { UpdateTodosFn } from './functions/implementations/update-todos.fn';
import { OutOfPathFn } from './functions/implementations/out-of-path.fn';
import { GetMemoriesFn } from './functions/implementations/get-memories.fn';
import { TenantMemoryModule } from '@modules/tenant-memory/tenant-memory.module';
import { FileStorageModule } from '@common/file-storage/file-storage.module';
import { SecurityEventRepository } from './repositories/security-event.repository';
import { FlowVersionRepository } from './repositories/flow-version.repository';
import { TemplateRepository } from './repositories/template.repository';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { PhonesModule } from '@modules/phones/phones.module';
import { QueueSystemModule } from '@modules/queue-system/queue-system.module';

@Module({
  imports: [DiscoveryModule, EvolutionModule, ExternalIntegrationsModule, ConversationSessionModule, PhonesModule, QueueSystemModule, TenantMemoryModule, FileStorageModule],
  controllers: [NodesController],
  providers: [
    NodesService,
    NodeRepository,
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
    CalculateSaleFn,
    TransitionToNodeFn,
    MoveToNegotiationFn,
    SalesRejectionFn,
    RegisterMissingProductFn,
    ExitFlowFn,
    SaveClientLocationFn,
    SaveProductPriceFn,
    SendToInternalChannelFn,
    UpdateTodosFn,
    OutOfPathFn,
    GetMemoriesFn,
    SecurityEventRepository,
    FlowVersionRepository,
    TemplateRepository,
  ],
  exports: [NodeRepository, ConversationSessionModule, IntentRepository, NodeRunnerService, NodeFunctionRegistry, FlowVersionRepository],
})
export class NodesModule {}
