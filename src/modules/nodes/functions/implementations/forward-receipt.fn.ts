import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { QueueRequestService } from '@modules/queue-system/services/queue-request.service';

@Injectable()
export class ForwardReceiptFn {
  private readonly logger = new Logger(ForwardReceiptFn.name);

  constructor(
    private readonly queueRequestService: QueueRequestService,
  ) {}

  @NodeFunction({
    code: 'forwardReceipt',
    name: 'Reenviar comprobante al usuario',
    description:
      'El cliente envió un comprobante de pago (imagen). Se reenvía al supervisor para revisión y aprobación. Pausa la conversación hasta recibir respuesta.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'forwardReceipt',
        description:
          'El cliente envió su comprobante de pago (IMAGEN). Reenvía la imagen al supervisor para que la revise y apruebe. Pausa la conversación hasta recibir respuesta. REQUISITO: solo llamar cuando el mensaje actual contiene una IMAGEN.',
        parameters: {
          type: 'object',
          properties: {
            clientName: {
              type: 'string',
              description: 'Nombre del cliente que envió el comprobante',
            },
            amount: {
              type: 'string',
              description: 'Monto total esperado del pago (ej: "Q<monto>")',
            },
            orderSummary: {
              type: 'string',
              description: 'Resumen breve del pedido para contexto (ej: "<cantidad> <producto>, envío <lugar>")',
            },
            receiptData: {
              type: 'string',
              description: 'Datos leídos visualmente del comprobante: monto real, banco, No. de referencia, cuenta destino, fecha (ej: "Monto: Q<monto>, Banco: <nombre banco>, Ref: <referencia>, Cuenta: <cuenta destino>, Fecha: <fecha>")',
            },
          },
          required: ['clientName', 'amount', 'receiptData'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const clientName = ctx.args?.clientName as string;
    const amount = ctx.args?.amount as string;
    const orderSummary = ctx.args?.orderSummary as string | undefined;
    const receiptData = ctx.args?.receiptData as string;

    if (!receiptData) {
      throw new Error(
        'forwardReceipt: falta receiptData. Debes leer visualmente el comprobante y extraer: monto real, banco, No. de referencia, cuenta destino y fecha.',
      );
    }

    if (!ctx.imageUrl) {
      throw new Error(
        'forwardReceipt: no hay imagen en el mensaje actual. El cliente debe enviar una imagen del comprobante.',
      );
    }

    if (!ctx.nodeSession) {
      throw new Error('forwardReceipt: no hay nodeSession activa');
    }

    const caption = [`Comprobante de ${clientName}`, `Total venta: ${amount}`, receiptData].join('\n');

    await this.queueRequestService.enqueue({
      userId: ctx.tenantId,
      nodeSessionId: ctx.nodeSession.id,
      conversationId: ctx.conversationId,
      currentNodeId: ctx.nodeSession.currentNodeId!,
      instanceName: ctx.instanceName,
      label: 'supervisor',
      message: caption,
      imageUrl: ctx.imageUrl,
      isTest: ctx.isTest,
      toolName: 'forwardReceipt',
      toolContext: { clientName, amount, orderSummary },
    });

    await ctx.sessionStore.updateStatus(ctx.nodeSession.id, 'waiting_queue');

    ctx.sideEffects.push({ action: 'waitingQueue', args: { label: 'supervisor' } });

    this.logger.log(
      `forwardReceipt: comprobante de ${clientName} encolado para supervisor${ctx.isTest ? ' [TEST]' : ''}`,
    );

    return 'Comprobante reenviado al supervisor. Esperando aprobación.';
  }
}
