import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@common/redis/redis.service';
import { SessionRepository } from '../repositories/session.repository';
import { FlowData } from '../langgraph/state.interface';

const FLOW_KEY_PREFIX = 'flow:';
const DEFAULT_TTL_SECONDS = 1800; // 30 min

@Injectable()
export class FlowCacheService {
  private readonly logger = new Logger(FlowCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly sessionRepository: SessionRepository,
  ) {}

  private key(conversationId: string): string {
    return `${FLOW_KEY_PREFIX}${conversationId}`;
  }

  async load(conversationId: string, sessionId: string): Promise<FlowData> {
    const cached = await this.redis.getJson<FlowData>(this.key(conversationId));
    if (cached)
      return {
        currentNodeId: cached.currentNodeId ?? null,
        nodes: cached.nodes ?? [],
      };

    // Cache miss: load from DB
    const session =
      await this.sessionRepository.findActiveByConversationId(conversationId);
    const raw = session?.flowData as unknown as Partial<FlowData> | null;
    const flowData: FlowData = {
      currentNodeId: raw?.currentNodeId ?? null,
      nodes: raw?.nodes ?? [],
    };

    await this.redis.setJson(
      this.key(conversationId),
      flowData,
      DEFAULT_TTL_SECONDS,
    );
    this.logger.debug(`Flow loaded from DB for ${conversationId}`);
    return flowData;
  }

  async save(conversationId: string, flowData: FlowData): Promise<void> {
    await this.redis.setJson(
      this.key(conversationId),
      flowData,
      DEFAULT_TTL_SECONDS,
    );
  }

  async flushToDb(conversationId: string, sessionId: string): Promise<void> {
    const flowData = await this.redis.getJson<FlowData>(
      this.key(conversationId),
    );
    if (flowData) {
      await this.sessionRepository.updateFlowData(sessionId, flowData);
      this.logger.log(`Flow flushed to DB for session ${sessionId}`);
    }
  }

  async clear(conversationId: string): Promise<void> {
    await this.redis.del(this.key(conversationId));
  }
}
