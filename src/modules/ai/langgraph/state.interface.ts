import { Annotation } from '@langchain/langgraph';
import { ApiName, MessageType } from '@prisma/client';

export type ApiError = { apiName: ApiName; message: string };
export type ConfigError = { message: string };
import { CreateApiCallData } from '../repositories/ai.repository';
import { TestSideEffect } from '@modules/nodes/functions/node-function.context';
import { NodeSessionStore } from '@modules/nodes/stores/node-session-store.interface';

export const WorkflowState = Annotation.Root({
  // Input (from IncomingMessageEvent)
  messageId: Annotation<string>,
  conversationId: Annotation<string>,
  instanceName: Annotation<string>,
  clientPhone: Annotation<string>,
  tenantId: Annotation<string>,
  messageType: Annotation<MessageType>,
  content: Annotation<string | null>,
  mediaRelativePath: Annotation<string | null>,
  mediaMetadata: Annotation<{ fileName: string; mimeType: string } | null>,

  // After Input Router
  transcription: Annotation<string>,

  // After Input Router (images)
  imageUrl: Annotation<string | null>,

  // Node routing (set by intent_router or route_decision)
  currentNodeId: Annotation<string | null>,
  flowId: Annotation<string | null>,
  nodeSessionId: Annotation<string | null>,
  routerAction: Annotation<'responder' | 'closeSession' | 'findFlowForIntent' | 'exitFlow' | 'flowRouted' | 'outOfPath' | null>,

  // After LLM / custom_node
  responseText: Annotation<string>,
  intent: Annotation<string>,
  preferredFormat: Annotation<'audio' | 'text'>,

  // After Output Router
  responseMediaRelativePath: Annotation<string | null>,
  responseMediaUrl: Annotation<string | null>,
  responseMimeType: Annotation<string | null>,
  responseFileName: Annotation<string | null>,
  responseFileSize: Annotation<number | null>,

  // Accumulated across nodes
  apiCalls: Annotation<CreateApiCallData[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  totalCost: Annotation<number>,

  // Session store (DB in prod, Redis in test)
  sessionStore: Annotation<NodeSessionStore>,

  // Indicates transition from HITL to AI — triggers entry_checker
  fromHitl: Annotation<boolean>,

  // Summary of the conversation (injected on fromHitl=true)
  conversationSummary: Annotation<string | null>,

  // Test mode
  isTest: Annotation<boolean>,
  sideEffects: Annotation<TestSideEffect[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  preCodeContext: Annotation<string | null>,
  nodeTransitions: Annotation<Array<{ from: string | null; to: string | null; reason: string }>>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  // Queue context (set when resuming from a queue response)
  queueContext: Annotation<string | null>,

  // Error tracking
  error: Annotation<ApiError | ConfigError>,
});

export type WorkflowStateType = typeof WorkflowState.State;
