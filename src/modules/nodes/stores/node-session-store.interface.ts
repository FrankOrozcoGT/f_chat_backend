import { Node, Flow, NodeSessionStatus } from '@prisma/client';

export interface SessionData {
  id: string;
  conversationId: string;
  flowId: string | null;
  currentNodeId: string | null;
  detectedIntent: string | null;
  flowSummary: string | null;
  status: NodeSessionStatus;
  currentNode: Node | null;
  flow: Flow | null;
}

export interface NodeSessionStore {
  findActiveByConversationId(conversationId: string): Promise<SessionData | null>;
  findById(id: string): Promise<SessionData | null>;
  findOrCreate(conversationId: string, flowId?: string): Promise<SessionData>;
  updateCurrentNode(id: string, currentNodeId: string | null, detectedIntent?: string): Promise<SessionData>;
  pauseFlow(id: string, summary: string): Promise<void>;
  close(id: string): Promise<void>;
}

export const NODE_SESSION_STORE = Symbol('NODE_SESSION_STORE');
