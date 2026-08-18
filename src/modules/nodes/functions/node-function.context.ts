import { Node, Flow } from '@prisma/client';
import { ToolChatResult } from '@common/external-integrations/kimi.client';
import { NodeSessionStore, SessionData } from '@common/conversation-session/stores/node-session-store.interface';

export interface TestSideEffect {
  action: string;
  args?: Record<string, unknown>;
}

export class NodeContext {
  // Input data
  messageId: string;
  tenantId: string;
  conversationId: string;
  transcription: string;
  history: { role: string; content: string }[];
  instanceName: string;
  clientPhone: string;
  clientName: string | null = null;
  clientId: string | null = null;
  imageUrl: string | null = null;
  mediaRelativePath: string | null = null;

  // Node data
  node: Node;
  nodeSession: SessionData;
  flow: Flow | null;

  // LLM result (only available in postCode)
  llmResult?: ToolChatResult;

  // Args passed to the function (available in tools, postCode, and preCode with { code, args } format)
  args?: Record<string, unknown>;

  // Session store (DB in prod, Redis in test)
  sessionStore: NodeSessionStore;

  // Test mode
  isTest = false;
  sideEffects: TestSideEffect[] = [];
}
