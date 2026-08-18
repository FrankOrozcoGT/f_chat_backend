import { Injectable } from '@nestjs/common';

export interface TestQueueSideEffect {
  action: string;
  args?: Record<string, unknown>;
}

export interface TestQueueResult {
  response: string;
  intent: string;
  currentNodeId: string | null;
  sideEffects: TestQueueSideEffect[];
  preCodeContext: string | null;
  nodeTransitions: Array<{ from: string | null; to: string | null; reason: string }>;
}

/**
 * In-memory store for async queue results in test mode.
 * When a queue job completes and triggers a second workflow run (via ai.incoming.message),
 * AiAgentService writes the result here keyed by conversationId.
 * sendTest polls this store to pick up the result before returning.
 */
@Injectable()
export class TestQueueResultStore {
  private readonly results = new Map<string, TestQueueResult>();

  set(conversationId: string, result: TestQueueResult): void {
    this.results.set(conversationId, result);
  }

  get(conversationId: string): TestQueueResult | null {
    return this.results.get(conversationId) ?? null;
  }

  clear(conversationId: string): void {
    this.results.delete(conversationId);
  }
}
