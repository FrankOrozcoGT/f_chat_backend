import { Annotation } from '@langchain/langgraph';
import { ApiName, MessageType } from '@prisma/client';
import { CreateApiCallData } from '../repositories/ai.repository';
import { TestSideEffect } from '../../nodes/functions/node-function.context';

export const WorkflowState = Annotation.Root({
  // Input (from IncomingMessageEvent)
  messageId: Annotation<string>,
  conversationId: Annotation<string>,
  instanceName: Annotation<string>,
  clientPhone: Annotation<string>,
  userId: Annotation<string>,
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
  routerAction: Annotation<'responder' | 'closeSession' | 'findFlowForIntent' | null>,

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
  apiCalls: Annotation<CreateApiCallData[]>,
  totalCost: Annotation<number>,

  // Test mode
  isTest: Annotation<boolean>,
  sideEffects: Annotation<TestSideEffect[]>,

  // Error tracking
  error: Annotation<{ step: string; apiName: ApiName; message: string } | null>,
});

export type WorkflowStateType = typeof WorkflowState.State;
