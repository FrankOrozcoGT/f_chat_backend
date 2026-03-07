import { Injectable, Logger } from '@nestjs/common';
import { NodeRepository } from '../repositories/node.repository';
import { NodeSessionRepository } from '../repositories/node-session.repository';
import { NodeRunnerService } from './node-runner.service';
import { SessionLifecycleService } from '../../ai/services/session-lifecycle.service';
import { NodeFunctionRegistry } from '../functions/node-function.registry';
import { NodeContext } from '../functions/node-function.context';

export interface DispatchInput {
  messageId: string;
  conversationId: string;
  userId: string;
  transcription: string;
  imageUrl: string | null;
  history: { role: string; content: string }[];
  instanceName: string;
  clientPhone: string;
}

export interface DispatchResult {
  response: string;
  intent: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  latencyMs: number;
}

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  constructor(
    private readonly nodeRepo: NodeRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly nodeRunner: NodeRunnerService,
    private readonly sessionLifecycle: SessionLifecycleService,
    private readonly fnRegistry: NodeFunctionRegistry,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const { messageId, conversationId, userId, transcription, imageUrl, history, instanceName, clientPhone } = input;

    // 1. Buscar flow del usuario
    const flow = await this.nodeRepo.findFlowByUserId(userId);
    if (!flow) {
      throw new Error(
        `No flow found for user ${userId}. Cannot dispatch without a flow.`,
      );
    }

    // 2. Obtener o crear NodeSession
    const nodeSession = await this.nodeSessionRepo.findOrCreate(
      conversationId,
      flow.id,
    );

    // 3. Determinar nodo activo: currentNode o router del flow
    const activeNode = nodeSession.currentNode ?? flow.routerNode;
    if (!activeNode) {
      throw new Error(
        `No active node for session ${nodeSession.id}. Flow ${flow.id} has no router node.`,
      );
    }

    this.logger.log(
      `Dispatching to node "${activeNode.name}" (${activeNode.id}) for conversation ${conversationId}`,
    );

    // 4. Construir contexto para las funciones
    const ctx = new NodeContext();
    ctx.messageId = messageId;
    ctx.userId = userId;
    ctx.conversationId = conversationId;
    ctx.transcription = transcription;
    ctx.history = history;
    ctx.instanceName = instanceName;
    ctx.clientPhone = clientPhone;
    ctx.node = activeNode;
    ctx.nodeSession = nodeSession;
    ctx.flow = flow;

    // 5. Ejecutar preCode pipeline
    let systemPromptExtra = '';
    const preCodePipeline = this.parsePreCode(activeNode.preCode);
    if (preCodePipeline.length > 0) {
      this.logger.log(
        `Running preCode pipeline: [${preCodePipeline.join(', ')}]`,
      );
      systemPromptExtra = await this.fnRegistry.executePreCode(
        preCodePipeline,
        ctx,
      );
    }

    // 6. Resolver tools del nodo desde el registry
    const toolCodes = this.parseToolCodes(activeNode.tools);
    const resolvedTools = toolCodes.length > 0
      ? this.fnRegistry.resolveTools(toolCodes)
      : null;

    // 7. Merge postCode con defaults y resolver como tools de terminación
    const postCodes = this.fnRegistry.mergePostCode(activeNode.postCode);
    const resolvedPostCode = this.fnRegistry.resolvePostCode(postCodes);

    // 8. Verificar que no haya duplicados entre tools y postCode
    const toolDefs = resolvedTools?.definitions || [];
    const toolHandlers = resolvedTools?.handlers || new Map();
    for (const postDef of resolvedPostCode.definitions) {
      const name = postDef.function.name;
      if (toolHandlers.has(name)) {
        throw new Error(
          `Function "${name}" appears in both tools and postCode for node "${activeNode.name}". ` +
          `A function must be either cyclic (tools) or termination (postCode), not both.`,
        );
      }
    }

    // 9. Merge definitions para Kimi (tools + postCode), pero handlers solo cíclicos
    const allDefinitions = [...toolDefs, ...resolvedPostCode.definitions];

    // 10. Ejecutar el nodo
    try {
      const result = await this.nodeRunner.run({
        node: activeNode,
        transcription,
        imageUrl,
        history,
        systemPromptExtra,
        toolDefinitions: allDefinitions,
        toolHandlers,
        terminationNames: resolvedPostCode.terminationNames,
        fnRegistry: this.fnRegistry,
        ctx,
      });

      this.logger.log(
        `Node "${activeNode.name}" completed: intent=${result.intent}, ${result.tokensInput}+${result.tokensOutput} tokens`,
      );

      // 11. Si terminó por postCode, ejecutar la función
      if (result.toolResult?.terminationTool) {
        const toolName = result.toolResult.terminationTool;
        const handler = resolvedPostCode.handlers.get(toolName);
        if (handler) {
          this.logger.log(`Running postCode function: "${toolName}"`);
          ctx.toolCallArgs = result.toolResult.terminationArgs ?? undefined;
          ctx.llmResult = result.toolResult;
          await handler.instance[handler.method](ctx);
          ctx.toolCallArgs = undefined;
        }
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Node "${activeNode.name}" failed: ${error.message}`,
      );

      if (activeNode.onError === 'hitl') {
        await this.sessionLifecycle.switchToHitl({
          conversationId,
          reason: 'api_error',
          userId,
          extras: {
            apiName: 'node',
            errorMessage: `[${activeNode.name}] ${error.message}`,
          },
        });
      }

      throw error;
    }
  }

  private parseToolCodes(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter((v) => typeof v === 'string');
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
        return [value];
      } catch {
        return [value];
      }
    }
    return [];
  }

  private parsePreCode(value: string | null): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string') return [parsed];
      return [];
    } catch {
      return [value];
    }
  }
}
