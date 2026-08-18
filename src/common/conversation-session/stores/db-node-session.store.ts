import { Injectable } from '@nestjs/common';
import { NodeSessionRepository } from '@common/conversation-session/node-session.repository';
import { CachedNodeData, NodeSessionStore, SessionData } from './node-session-store.interface';

@Injectable()
export class DbNodeSessionStore implements NodeSessionStore {
  constructor(private readonly repo: NodeSessionRepository) {}

  async findActiveByConversationId(conversationId: string): Promise<SessionData | null> {
    return this.repo.findActiveByConversationId(conversationId);
  }

  async findActiveOrWaitingByConversationId(conversationId: string): Promise<SessionData | null> {
    return this.repo.findActiveOrWaitingByConversationId(conversationId);
  }

  async findById(id: string): Promise<SessionData | null> {
    return this.repo.findById(id);
  }

  async findOrCreate(conversationId: string, flowId?: string): Promise<SessionData> {
    return this.repo.findOrCreate(conversationId, flowId);
  }

  async updateCurrentNode(id: string, currentNodeId: string | null, detectedIntent?: string, flowId?: string, flowSummary?: string): Promise<SessionData> {
    return this.repo.updateCurrentNode(id, currentNodeId, detectedIntent, flowId, flowSummary);
  }

  async updateStatus(id: string, status: import('@prisma/client').NodeSessionStatus): Promise<void> {
    await this.repo.updateStatus(id, status);
  }

  async updateCompletedTodos(id: string, todos: Record<string, boolean>): Promise<import('./node-session-store.interface').SessionData> {
    return this.repo.updateCompletedTodos(id, todos) as any;
  }

  async pauseFlow(id: string, summary: string): Promise<void> {
    await this.repo.pauseFlow(id, summary);
  }

  async setCachedNodeData(id: string, data: CachedNodeData): Promise<void> {
    await this.repo.setCachedNodeData(id, data);
  }

  async close(id: string): Promise<void> {
    await this.repo.close(id);
  }

  toJSON() {
    return { type: 'DbNodeSessionStore' };
  }
}
