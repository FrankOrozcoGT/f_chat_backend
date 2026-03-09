import { Injectable, NotFoundException } from '@nestjs/common';
import { RedisService } from '@common/redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

export interface TestStep {
  message: string;
  response: string;
  nodeId: string | null;
  historySnapshot: Array<{ role: string; content: string }>;
}

export interface TestSession {
  testId: string;
  conversationId: string;
  flowId: string;
  clientPhone: string;
  instanceName: string;
  userId: string;
  currentNodeId: string | null;
  steps: TestStep[];
  history: Array<{ role: string; content: string }>;
}

const KEY_PREFIX = 'test-session';
const TTL_SECONDS = 3600; // 1 hora

@Injectable()
export class TestSessionService {
  constructor(private readonly redis: RedisService) {}

  async start(
    conversationId: string,
    flowId: string,
    clientPhone: string,
    instanceName: string,
    userId: string,
  ): Promise<string> {
    const testId = uuidv4();
    const session: TestSession = {
      testId,
      conversationId,
      flowId,
      clientPhone,
      instanceName,
      userId,
      currentNodeId: null,
      steps: [],
      history: [],
    };
    await this.redis.setJson(`${KEY_PREFIX}:${testId}`, session, TTL_SECONDS);
    return testId;
  }

  async getSession(testId: string): Promise<TestSession> {
    const session = await this.redis.getJson<TestSession>(`${KEY_PREFIX}:${testId}`);
    if (!session) throw new NotFoundException(`Test session ${testId} not found or expired`);
    return session;
  }

  async pushStep(testId: string, step: TestStep): Promise<void> {
    const session = await this.getSession(testId);
    session.steps.push(step);
    session.currentNodeId = step.nodeId;
    session.history = step.historySnapshot;
    await this.redis.setJson(`${KEY_PREFIX}:${testId}`, session, TTL_SECONDS);
  }

  async popStep(testId: string): Promise<{ currentNodeId: string | null; lastMessage: string | null }> {
    const session = await this.getSession(testId);
    if (session.steps.length === 0) {
      return { currentNodeId: null, lastMessage: null };
    }
    session.steps.pop();
    const prevStep = session.steps[session.steps.length - 1] ?? null;
    session.currentNodeId = prevStep?.nodeId ?? null;
    session.history = prevStep?.historySnapshot ?? [];
    await this.redis.setJson(`${KEY_PREFIX}:${testId}`, session, TTL_SECONDS);
    return {
      currentNodeId: session.currentNodeId,
      lastMessage: prevStep?.response ?? null,
    };
  }

  async deleteSession(testId: string): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}:${testId}`);
  }
}
