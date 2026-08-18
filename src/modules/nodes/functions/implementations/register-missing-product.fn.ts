import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '@common/external-integrations/internal-api.client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { QueueRequestService } from '@modules/queue-system/services/queue-request.service';

@Injectable()
export class RegisterMissingProductFn {
  private readonly logger = new Logger(RegisterMissingProductFn.name);

  constructor(
    private readonly internalApi: InternalApiClient,
    private readonly queueRequestService: QueueRequestService,
  ) {}

  @NodeFunction({
    code: 'registerMissingProduct',
    name: 'Registrar producto faltante',
    description:
      'Producto no encontrado en catálogo. Registra en CRM y encola consulta al supervisor para obtener precio. NO responde al cliente.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'registerMissingProduct',
        description:
          'Producto no encontrado en catálogo. Registra solicitud y consulta precio al supervisor. No envía mensaje al cliente.',
        parameters: {
          type: 'object',
          properties: {
            productName: {
              type: 'string',
              description: 'Nombre del producto que busca el cliente.',
            },
            notes: {
              type: 'string',
              description: 'Detalles adicionales (modelo, especificaciones, etc.).',
            },
          },
          required: ['productName', 'notes'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const productName = ctx.args?.productName as string;
    const notes = ctx.args?.notes as string;

    if (!productName || !notes) {
      throw new Error(
        'registerMissingProduct: "productName" y "notes" son requeridos',
      );
    }

    const conversation = await this.internalApi.getConversationFull(ctx.conversationId);
    const clientId = conversation.client?.id ?? null;
    const clientName = conversation.client?.name || ctx.clientPhone;

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'registerMissingProduct',
        args: { productName, notes, clientId },
      });
      this.logger.log(`registerMissingProduct [TEST]: ${productName}`);
      return 'Producto registrado como faltante. Enviado a cola del supervisor.';
    }

    // 1. Registrar producto placeholder en catálogo
    await this.internalApi.registerMissingProduct(
      ctx.tenantId,
      productName,
      clientId,
      notes,
    );

    // 2. Encolar consulta al supervisor para obtener precio
    await this.queueRequestService.enqueue({
      userId: ctx.tenantId,
      nodeSessionId: ctx.nodeSession.id,
      conversationId: ctx.conversationId,
      currentNodeId: ctx.node.id,
      instanceName: ctx.instanceName,
      label: 'supervisor',
      message: `Cliente "${clientName}" pregunta por producto "${productName}". Detalles: ${notes}. ¿Cuál es el precio?`,
      toolName: 'registerMissingProduct',
      toolContext: { productName, notes, clientId },
    });

    this.logger.log(`registerMissingProduct: ${productName} → enqueued to supervisor`);

    return 'Producto registrado como faltante. Consulta enviada al supervisor.';
  }
}
