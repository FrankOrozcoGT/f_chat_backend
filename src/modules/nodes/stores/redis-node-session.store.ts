import { NodeSessionStatus } from '@prisma/client';
import { RedisService } from '@common/redis/redis.service';
import { NodeRepository } from '@modules/nodes/repositories/node.repository';
import { CachedNodeData, NodeSessionStore, SessionData } from '@modules/nodes/stores/node-session-store.interface';
import { v4 as uuidv4 } from 'uuid';

const KEY_PREFIX = 'test-node-session';
const TTL_SECONDS = 3600;

interface RedisSessionState {
  id: string;
  conversationId: string;
  flowId: string | null;
  currentNodeId: string | null;
  detectedIntent: string | null;
  flowSummary: string | null;
  status: NodeSessionStatus;
}

/**
 * NodeSessionStore backed by Redis for test mode.
 * State (currentNodeId, status) lives in Redis.
 * Static data (currentNode, flow) is fetched from DB via NodeRepository.
 */
export class RedisNodeSessionStore implements NodeSessionStore {
  constructor(
    private readonly redis: RedisService,
    private readonly nodeRepo: NodeRepository,
  ) {}

  private convKey(conversationId: string): string {
    return `${KEY_PREFIX}:conv:${conversationId}`;
  }

  private idKey(id: string): string {
    return `${KEY_PREFIX}:id:${id}`;
  }

  private async save(state: RedisSessionState): Promise<void> {
    await Promise.all([
      this.redis.setJson(this.convKey(state.conversationId), state, TTL_SECONDS),
      this.redis.setJson(this.idKey(state.id), state, TTL_SECONDS),
    ]);
  }

  private async hydrate(state: RedisSessionState): Promise<SessionData> {
    const [currentNode, flow] = await Promise.all([
      state.currentNodeId ? this.nodeRepo.findById(state.currentNodeId) : null,
      state.flowId ? this.nodeRepo.findFlowWithNodes(state.flowId) : null,
    ]);
    return {
      id: state.id,
      conversationId: state.conversationId,
      flowId: state.flowId,
      currentNodeId: state.currentNodeId,
      detectedIntent: state.detectedIntent,
      flowSummary: state.flowSummary,
      cachedNodeData: null,
      status: state.status,
      currentNode: currentNode ?? null,
      flow: flow ?? null,
    };
  }

  async findActiveByConversationId(conversationId: string): Promise<SessionData | null> {
    const state = await this.redis.getJson<RedisSessionState>(this.convKey(conversationId));
    if (!state || state.status !== 'active') return null;
    return this.hydrate(state);
  }

  async findById(id: string): Promise<SessionData | null> {
    const state = await this.redis.getJson<RedisSessionState>(this.idKey(id));
    if (!state) return null;
    return this.hydrate(state);
  }

  async findOrCreate(conversationId: string, flowId?: string): Promise<SessionData> {
    const existing = await this.redis.getJson<RedisSessionState>(this.convKey(conversationId));
    if (existing && existing.status === 'active') {
      return this.hydrate(existing);
    }
    const state: RedisSessionState = {
      id: uuidv4(),
      conversationId,
      flowId: flowId ?? null,
      currentNodeId: null,
      detectedIntent: null,
      flowSummary: null,
      status: 'active',
    };
    await this.save(state);
    return this.hydrate(state);
  }

  async updateCurrentNode(id: string, currentNodeId: string | null, detectedIntent?: string, flowId?: string, flowSummary?: string): Promise<SessionData> {
    const state = await this.redis.getJson<RedisSessionState>(this.idKey(id));
    if (!state) {
      throw new Error(`RedisNodeSessionStore.updateCurrentNode: session ${id} not found`);
    }
    state.currentNodeId = currentNodeId;
    if (detectedIntent !== undefined) state.detectedIntent = detectedIntent;
    if (flowId !== undefined) state.flowId = flowId;
    if (flowSummary !== undefined) state.flowSummary = flowSummary;
    await this.save(state);
    return this.hydrate(state);
  }

  async pauseFlow(id: string, summary: string): Promise<void> {
    const state = await this.redis.getJson<RedisSessionState>(this.idKey(id));
    if (state) {
      state.currentNodeId = null;
      state.detectedIntent = null;
      state.flowId = null;
      state.flowSummary = summary;
      await this.save(state);
    }
  }

  async setCachedNodeData(_id: string, _data: CachedNodeData): Promise<void> {
    // No-op in test mode — sessions are ephemeral
  }

  async close(id: string): Promise<void> {
    const state = await this.redis.getJson<RedisSessionState>(this.idKey(id));
    if (state) {
      state.status = 'closed';
      await this.save(state);
    }
  }

  toJSON() {
    return { type: 'RedisNodeSessionStore' };
  }
}
