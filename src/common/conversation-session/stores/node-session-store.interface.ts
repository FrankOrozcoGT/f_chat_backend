import { Node, Flow, NodeSessionStatus, Prisma } from '@prisma/client';

export interface CachedNodeData {
  node: Node;
  flow: Flow | null;
  preCodeResult: string | null;
}

export interface SessionData {
  id: string;
  conversationId: string;
  flowId: string | null;
  currentNodeId: string | null;
  detectedIntent: string | null;
  flowSummary: string | null;
  cachedNodeData: CachedNodeData | Prisma.JsonValue | null;
  completedTodos: Record<string, boolean> | Prisma.JsonValue | null;
  status: NodeSessionStatus;
  currentNode: Node | null;
  flow: Flow | null;
}

export interface NodeSessionStore {
  findActiveByConversationId(conversationId: string): Promise<SessionData | null>;
  findActiveOrWaitingByConversationId(conversationId: string): Promise<SessionData | null>;
  findById(id: string): Promise<SessionData | null>;
  findOrCreate(conversationId: string, flowId?: string): Promise<SessionData>;
  updateCurrentNode(id: string, currentNodeId: string | null, detectedIntent?: string, flowId?: string, flowSummary?: string): Promise<SessionData>;
  updateStatus(id: string, status: NodeSessionStatus): Promise<void>;
  setCachedNodeData(id: string, data: CachedNodeData): Promise<void>;
  updateCompletedTodos(id: string, todos: Record<string, boolean>): Promise<SessionData>;
  pauseFlow(id: string, summary: string): Promise<void>;
  close(id: string): Promise<void>;
}
