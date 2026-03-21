import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { QueueRequestService } from '@modules/queue-system/services/queue-request.service';
import { InternalApiClient } from '@modules/ai/clients/internal-api.client';
import { FileStorageService } from '@common/file-storage/file-storage.service';

@Injectable()
export class SendToVerificationFn {
  private readonly logger = new Logger(SendToVerificationFn.name);

  constructor(
    private readonly queueRequestService: QueueRequestService,
    private readonly internalApi: InternalApiClient,
    private readonly fileStorageService: FileStorageService,
  ) {}

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
            sourceMessageId: {
              type: 'string',
              description: 'ID del mensaje que contiene la imagen del comprobante (se ve como [messageId:xxx] en el historial)',
            },
          },
          required: ['clientName', 'amount', 'sourceMessageId'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const clientName = ctx.args?.clientName as string;
    const amount = ctx.args?.amount as string;
    const receiptSummary = ctx.args?.receiptSummary as string | undefined;
    const sourceMessageId = ctx.args?.sourceMessageId as string;

    this.logger.log(
      `sendToVerification: args=${JSON.stringify(ctx.args)} isTest=${ctx.isTest} nodeSession=${ctx.nodeSession?.id}`,
    );

    if (!ctx.nodeSession) {
      throw new Error('sendToVerification: no hay nodeSession activa');
    }

    if (!sourceMessageId) {
      throw new Error('sendToVerification: "sourceMessageId" es requerido — busca en el historial el mensaje con [messageId:xxx] que contiene la imagen del comprobante');
    }

    // Resolver la imagen del mensaje referenciado
    let imageUrl: string | undefined;
    if (!ctx.isTest) {
      const sourceMessage = await this.internalApi.getMessageById(sourceMessageId);
      this.logger.log(
        `sendToVerification: sourceMessage=${JSON.stringify(sourceMessage)}`,
      );
      if (!sourceMessage) {
        throw new Error(`sendToVerification: mensaje "${sourceMessageId}" no encontrado — el messageId debe venir del historial, búscalo como [messageId:xxx] en el mensaje donde el cliente envió la imagen del comprobante`);
      }
      if (!sourceMessage.mediaUrl) {
        throw new Error(`sendToVerification: el mensaje "${sourceMessageId}" no tiene imagen — asegúrate de usar el [messageId:xxx] del mensaje donde el cliente envió la imagen, no de otro mensaje`);
      }
      imageUrl = this.fileStorageService.buildDockerAccessibleUrl(sourceMessage.mediaUrl);
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
      imageUrl,
      isTest: ctx.isTest,
      toolName: 'sendToVerification',
      toolContext: { clientName, amount, receiptSummary, sourceMessageId },
    });

    await ctx.sessionStore.updateStatus(ctx.nodeSession.id, 'waiting_queue');

    ctx.sideEffects.push({ action: 'waitingQueue', args: { label: 'grupo_verificacion' } });

    this.logger.log(
      `sendToVerification: enqueued for grupo_verificacion — ${clientName} Q${amount}`,
    );

    return 'Enviado a verificación. Esperando confirmación de la supervisora.';
  }
}
