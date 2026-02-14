import { Annotation } from '@langchain/langgraph';
import { MessageType } from '@prisma/client';
import { CreateApiCallData } from '../repositories/ai.repository';

// Flow data interfaces (used in Redis + Session.flowData JSON)

export interface FlowNode {
  nodeId: string;
  parentId: string | null;
  status: 'active' | 'collapsed' | 'reopened';
  understanding: string;
  messageIds: string[];
}

export interface FlowData {
  currentNodeId: string | null;
  nodes: FlowNode[];
}

export type FlowAction =
  | 'NONE'
  | 'CREATE'
  | 'SHIFT_FOCUS'
  | 'BACK_TO_OBJECTIVE'
  | 'DIRECTION_CHANGE'
  | 'END_CONVERSATION';

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

  // After Flow Analyzer
  sessionId: Annotation<string | null>,
  flowAction: Annotation<FlowAction | null>,
  flowData: Annotation<FlowData | null>,

  // After Context Builder
  contextForLlm: Annotation<string | null>,

  // After LLM
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
});

export type WorkflowStateType = typeof WorkflowState.State;
