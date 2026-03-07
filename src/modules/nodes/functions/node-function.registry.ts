import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
  NODE_FUNCTION_METADATA,
  NodeFunctionMeta,
} from './node-function.decorator';
import { NodeContext } from './node-function.context';
import { ToolDefinition } from '../../ai/clients/kimi.client';

interface RegisteredFunction {
  meta: NodeFunctionMeta;
  instance: any;
  method: string;
}

// Default postCode outputs que siempre se agregan a todo nodo
const DEFAULT_POST_CODES: string[] = ['switchToHitl'];

@Injectable()
export class NodeFunctionRegistry implements OnModuleInit {
  private readonly logger = new Logger(NodeFunctionRegistry.name);
  private readonly functions = new Map<string, RegisteredFunction>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit() {
    const providers = this.discovery.getProviders();

    for (const wrapper of providers) {
      const { instance } = wrapper;
      if (!instance || !instance.constructor) continue;

      const metas: (NodeFunctionMeta & { _method: string })[] =
        Reflect.getMetadata(NODE_FUNCTION_METADATA, instance.constructor) || [];

      for (const meta of metas) {
        if (this.functions.has(meta.code)) {
          throw new Error(
            `Duplicate NodeFunction code "${meta.code}". Each function must have a unique code. ` +
              `Existing: ${this.functions.get(meta.code)!.meta.name}, ` +
              `Duplicate: ${meta.name}`,
          );
        }

        this.functions.set(meta.code, {
          meta: {
            code: meta.code,
            name: meta.name,
            description: meta.description,
            toolDefinition: meta.toolDefinition,
            outputSchema: meta.outputSchema,
          },
          instance,
          method: meta._method,
        });
        this.logger.log(`Registered node function: "${meta.code}" (${meta.name})`);
      }
    }
  }

  has(code: string): boolean {
    return this.functions.has(code);
  }

  async execute(code: string, ctx: NodeContext): Promise<string> {
    const fn = this.functions.get(code);
    if (!fn) {
      throw new Error(
        `Node function "${code}" not found in registry. Available: ${[...this.functions.keys()].join(', ')}`,
      );
    }
    return fn.instance[fn.method](ctx);
  }

  getMeta(code: string): NodeFunctionMeta | undefined {
    return this.functions.get(code)?.meta;
  }

  /**
   * Resolve tool codes from DB to ToolDefinitions + handlers.
   * The handler map is keyed by the tool's function.name (what the LLM calls).
   */
  resolveTools(toolCodes: string[]): {
    definitions: ToolDefinition[];
    handlers: Map<string, RegisteredFunction>;
  } {
    const definitions: ToolDefinition[] = [];
    const handlers = new Map<string, RegisteredFunction>();

    for (const code of toolCodes) {
      const fn = this.functions.get(code);
      if (!fn) {
        throw new Error(
          `Tool "${code}" not found in registry. Available: ${[...this.functions.keys()].join(', ')}`,
        );
      }
      if (!fn.meta.toolDefinition) {
        throw new Error(
          `Function "${code}" (${fn.meta.name}) does not have a toolDefinition. It cannot be used as a tool.`,
        );
      }
      definitions.push(fn.meta.toolDefinition);
      handlers.set(fn.meta.toolDefinition.function.name, fn);
    }

    return { definitions, handlers };
  }

  /**
   * Execute a preCode pipeline: array of function codes.
   * Returns formatted context string to append to system prompt.
   */
  async executePreCode(
    pipeline: string[],
    ctx: NodeContext,
  ): Promise<string> {
    const outputs: string[] = [];

    for (const code of pipeline) {
      const result = await this.execute(code, ctx);
      const meta = this.getMeta(code);
      outputs.push(
        `[${meta?.name || code}]: ${meta?.description || 'Sin descripción'}\n→ ${result}`,
      );
    }

    return outputs.length > 0
      ? `\n--- Contexto adicional ---\n${outputs.join('\n\n')}`
      : '';
  }

  /**
   * Parse postCode from DB (string[] JSON) and merge with defaults.
   * Deduplicates codes.
   */
  mergePostCode(postCodeRaw: string | null): string[] {
    const codes = new Set<string>();

    if (postCodeRaw) {
      try {
        const parsed = JSON.parse(postCodeRaw);
        if (Array.isArray(parsed)) {
          for (const code of parsed) {
            if (typeof code === 'string') codes.add(code);
          }
        }
      } catch {
        this.logger.warn(`Invalid postCode JSON: ${postCodeRaw}`);
      }
    }

    for (const code of DEFAULT_POST_CODES) {
      codes.add(code);
    }

    return [...codes];
  }

  /**
   * Resolve postCode codes to ToolDefinitions + handlers.
   * If a function has an explicit toolDefinition, use it.
   * Otherwise, auto-generate one from code, description, and outputSchema.
   */
  resolvePostCode(postCodes: string[]): {
    definitions: ToolDefinition[];
    handlers: Map<string, RegisteredFunction>;
    terminationNames: Set<string>;
  } {
    const definitions: ToolDefinition[] = [];
    const handlers = new Map<string, RegisteredFunction>();
    const terminationNames = new Set<string>();

    for (const code of postCodes) {
      const fn = this.functions.get(code);
      if (!fn) {
        throw new Error(
          `PostCode "${code}" not found in registry. Available: ${[...this.functions.keys()].join(', ')}`,
        );
      }

      const toolDef = fn.meta.toolDefinition || this.autoToolDefinition(fn.meta);
      definitions.push(toolDef);
      handlers.set(toolDef.function.name, fn);
      terminationNames.add(toolDef.function.name);
    }

    return { definitions, handlers, terminationNames };
  }

  /**
   * Auto-generate a ToolDefinition from a function's metadata.
   * Uses code as name, description from decorator, and outputSchema as parameters.
   */
  private autoToolDefinition(meta: NodeFunctionMeta): ToolDefinition {
    const properties: Record<string, unknown> = meta.outputSchema || {};
    const required = Object.keys(properties);

    return {
      type: 'function',
      function: {
        name: meta.code,
        description: meta.description,
        parameters: required.length > 0
          ? { type: 'object', properties, required }
          : { type: 'object', properties: {} },
      },
    };
  }
}
