import { Injectable, NotFoundException } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { RedisService } from '@common/redis/redis.service';
import { TestQueueResultStore } from '@common/conversation-session/test-queue-result.store';
import { AiWorkflow } from './langgraph/workflow';
import { v4 as uuidv4 } from 'uuid';

export interface TestStep {
  message: string;
  response: string;
  nodeId: string | null;
  flowId?: string | null;
  historySnapshot: Array<{ role: string; content: string }>;
}

export interface TestSession {
  testId: string;
  conversationId: string;
  flowId: string | null;
  clientPhone: string;
  instanceName: string;
  tenantId: string;
  currentNodeId: string | null;
  steps: TestStep[];
  history: Array<{ role: string; content: string }>;
}

const KEY_PREFIX = 'test-session';
const TTL_SECONDS = 3600; // 1 hora

export interface SendTestMessageResult {
  response: string;
  intent: string;
  currentNodeId: string | null;
  sideEffects: { action: string; args?: Record<string, unknown> }[];
  preCodeContext: string | null;
  nodeTransitions: Array<{ from: string | null; to: string | null; reason: string }>;
}

@Injectable()
export class TestSessionService {
  constructor(
    private readonly redis: RedisService,
    private readonly testQueueResultStore: TestQueueResultStore,
    private readonly workflow: AiWorkflow,
  ) {}

  async start(
    conversationId: string,
    flowId: string | null,
    clientPhone: string,
    instanceName: string,
    tenantId: string,
  ): Promise<string> {
    const testId = uuidv4();
    const session: TestSession = {
      testId,
      conversationId,
      flowId,
      clientPhone,
      instanceName,
      tenantId,
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
    if (step.flowId !== undefined) session.flowId = step.flowId;
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
    session.flowId = prevStep?.flowId ?? null;
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

  /**
   * Ejecuta el workflow de LangGraph en modo test para un mensaje, siguiendo
   * el encadenamiento vía queue si el workflow lo requiere (sendToInternalChannel
   * → transitionToNode), y persiste el step resultante.
   */
  async sendMessage(testId: string, message: string, mediaUrl?: string): Promise<SendTestMessageResult> {
    const session = await this.getSession(testId);

    // Clear any leftover queue result from a previous step
    this.testQueueResultStore.clear(session.conversationId);

    const result = await this.workflow.execute(
      {
        messageId: `test-${testId}-${Date.now()}`,
        conversationId: session.conversationId,
        instanceName: session.instanceName,
        clientPhone: session.clientPhone,
        tenantId: session.tenantId,
        messageType: mediaUrl ? MessageType.image : MessageType.text,
        content: message,
        mediaRelativePath: mediaUrl ? mediaUrl.replace(/^https?:\/\/[^/]+\//, '') : null,
        mediaMetadata: mediaUrl ? { fileName: 'comprobante.jpeg', mimeType: 'image/jpeg' } : null,
      },
      true, // isTest
    );

    // Extraer response del side effect sendMessage si responseText está vacío
    const sendMsg = result.sideEffects.find((se) => se.action === 'sendMessage');
    let response = result.responseText || (sendMsg?.args?.mensaje as string) || '';

    // Campos que se sobreescriben si el workflow encadena vía queue
    let currentNodeId = result.currentNodeId;
    let intent = result.intent;
    let preCodeContext = result.preCodeContext;
    const allNodeTransitions = [...(result.nodeTransitions ?? [])];

    // Poll in loop — workflows can chain (sendToInternalChannel → transitionToNode)
    let currentSideEffects: { action: string }[] = result.sideEffects;
    while (currentSideEffects.some((se) => se.action === 'waitingQueue')) {
      const queueResult = await this.pollQueueResult(session.conversationId, 15000);
      if (!queueResult) break;
      this.testQueueResultStore.clear(session.conversationId);
      allNodeTransitions.push(...(queueResult.nodeTransitions ?? []));
      currentNodeId = queueResult.currentNodeId ?? currentNodeId;
      intent = queueResult.intent ?? intent;
      preCodeContext = queueResult.preCodeContext ?? preCodeContext;
      response = queueResult.response || response;
      currentSideEffects = queueResult.sideEffects ?? [];
    }

    const updatedHistory = [
      ...session.history,
      { role: 'user', content: message },
    ];
    if (response) {
      updatedHistory.push({ role: 'assistant', content: response });
    }

    await this.pushStep(testId, {
      message,
      response,
      nodeId: currentNodeId,
      flowId: session.flowId,
      historySnapshot: updatedHistory,
    });

    return {
      response,
      intent,
      currentNodeId,
      sideEffects: result.sideEffects,
      preCodeContext: preCodeContext ?? null,
      nodeTransitions: allNodeTransitions,
    };
  }

  /**
   * Polls for an async queue result in test mode.
   * The result is written by AiAgentService after the second workflow completes.
   */
  private async pollQueueResult(conversationId: string, timeoutMs: number) {
    const interval = 200;
    const maxAttempts = Math.ceil(timeoutMs / interval);
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, interval));
      const result = this.testQueueResultStore.get(conversationId);
      if (result) return result;
    }
    return null;
  }
}
