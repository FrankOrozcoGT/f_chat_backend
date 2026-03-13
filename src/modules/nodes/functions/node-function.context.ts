import { Node, Flow } from '@prisma/client';
import { ToolChatResult } from '../../ai/clients/kimi.client';
import { NodeSessionStore, SessionData } from '@modules/nodes/stores/node-session-store.interface';

export interface TestSideEffect {
  action: string;
  args?: Record<string, unknown>;
}

export class NodeContext {
  // Input data
  messageId: string;
  userId: string;
  conversationId: string;
  transcription: string;
  history: { role: string; content: string }[];
  instanceName: string;
  clientPhone: string;

  // Node data
  node: Node;
  nodeSession: SessionData;
  flow: Flow | null;

  // LLM result (only available in postCode)
  llmResult?: ToolChatResult;

  // Tool call args (only available when executing as a tool)
  toolCallArgs?: Record<string, unknown>;

  // Session store (DB in prod, Redis in test)
  sessionStore: NodeSessionStore;

  // Test mode
  isTest = false;
  sideEffects: TestSideEffect[] = [];
}
