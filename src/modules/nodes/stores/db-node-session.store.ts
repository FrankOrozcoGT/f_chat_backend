import { Injectable } from '@nestjs/common';
import { NodeSessionRepository } from '@modules/nodes/repositories/node-session.repository';
import { CachedNodeData, NodeSessionStore, SessionData } from './node-session-store.interface';

@Injectable()
export class DbNodeSessionStore implements NodeSessionStore {
  constructor(private readonly repo: NodeSessionRepository) {}

  async findActiveByConversationId(conversationId: string): Promise<SessionData | null> {
    return this.repo.findActiveByConversationId(conversationId) as Promise<SessionData | null>;
  }

  async findById(id: string): Promise<SessionData | null> {
    return this.repo.findById(id) as Promise<SessionData | null>;
  }

  async findOrCreate(conversationId: string, flowId?: string): Promise<SessionData> {
    return this.repo.findOrCreate(conversationId, flowId) as Promise<SessionData>;
  }

  async updateCurrentNode(id: string, currentNodeId: string | null, detectedIntent?: string, flowId?: string, flowSummary?: string): Promise<SessionData> {
    return this.repo.updateCurrentNode(id, currentNodeId, detectedIntent, flowId, flowSummary) as Promise<SessionData>;
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
