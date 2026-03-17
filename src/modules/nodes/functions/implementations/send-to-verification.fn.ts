import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { QueueRequestService } from '@modules/queue-system/services/queue-request.service';

@Injectable()
export class SendToVerificationFn {
  private readonly logger = new Logger(SendToVerificationFn.name);

  constructor(private readonly queueRequestService: QueueRequestService) {}

  @NodeFunction({
    code: 'sendToVerification',
    name: 'Enviar a verificación',
    description:
      'El usuario aprobó el comprobante. Se envía al grupo de verificación y se espera confirmación de la supervisora. Pausa la conversación hasta recibir respuesta.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'sendToVerification',
        description:
          'El usuario aprobó el comprobante del cliente. Envía al grupo de verificación para confirmación de la supervisora. La conversación se pausa hasta recibir "confirmado".',
        parameters: {
          type: 'object',
          properties: {
            clientName: {
              type: 'string',
              description: 'Nombre del cliente',
            },
            amount: {
              type: 'string',
              description: 'Monto del pago',
            },
            receiptSummary: {
              type: 'string',
              description: 'Resumen del comprobante (banco, referencia, etc.)',
            },
          },
          required: ['clientName', 'amount'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const clientName = ctx.toolCallArgs?.clientName as string;
    const amount = ctx.toolCallArgs?.amount as string;
    const receiptSummary = ctx.toolCallArgs?.receiptSummary as string | undefined;

    if (!ctx.nodeSession) {
      throw new Error('sendToVerification: no hay nodeSession activa');
    }

    const message = receiptSummary
      ? `Comprobante de pago — ${clientName}\nMonto: Q${amount}\n${receiptSummary}`
      : `Comprobante de pago — ${clientName}\nMonto: Q${amount}`;

    await this.queueRequestService.enqueue({
      userId: ctx.tenantId,
      nodeSessionId: ctx.nodeSession.id,
      conversationId: ctx.conversationId,
      currentNodeId: ctx.nodeSession.currentNodeId!,
      instanceName: ctx.instanceName,
      label: 'grupo_verificacion',
      message,
      isTest: ctx.isTest,
      toolName: 'sendToVerification',
      toolContext: { clientName, amount, receiptSummary },
    });

    await ctx.sessionStore.updateStatus(ctx.nodeSession.id, 'waiting_queue');

    ctx.sideEffects.push({ action: 'waitingQueue', args: { label: 'grupo_verificacion' } });

    this.logger.log(
      `sendToVerification: enqueued for grupo_verificacion — ${clientName} Q${amount}`,
    );

    return 'Enviado a verificación. Esperando confirmación de la supervisora.';
  }
}
