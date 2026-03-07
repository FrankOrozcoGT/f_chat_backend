import { Node, Flow, NodeSession } from '@prisma/client';
import { ToolChatResult } from '../../ai/clients/kimi.client';

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
  nodeSession: NodeSession;
  flow: Flow;

  // LLM result (only available in postCode)
  llmResult?: ToolChatResult;

  // Tool call args (only available when executing as a tool)
  toolCallArgs?: Record<string, unknown>;
}
