import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { QueueRequestService } from '@modules/queue-system/services/queue-request.service';
import { FileStorageService } from '@common/file-storage/file-storage.service';

@Injectable()
export class SendToInternalChannelFn {
  private readonly logger = new Logger(SendToInternalChannelFn.name);

  constructor(
    private readonly queueRequestService: QueueRequestService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  @NodeFunction({
    code: 'sendToInternalChannel',
    name: 'Enviar mensaje a canal interno',
    description:
      'Envía un mensaje (opcional con imagen adjunta del mensaje actual) al canal interno identificado por channelName. Pausa la conversación hasta recibir respuesta.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'sendToInternalChannel',
        description:
          'Envía un mensaje al canal interno del negocio (ej: técnico, vendedor, supervisor). La conversación queda pausada esperando la respuesta del canal. Usa channelName exactamente como aparece en la lista de internals del nodo. Si el cliente acaba de enviar una imagen y necesitas reenviarla, pon attachCurrentImage=true.',
        parameters: {
          type: 'object',
          properties: {
            channelName: {
              type: 'string',
              description: 'Identificador del canal interno (channelName del ContactLabel)',
            },
            message: {
              type: 'string',
              description: 'Mensaje a enviar al canal interno. Debe ser claro y contener el contexto necesario para que responda.',
            },
            attachCurrentImage: {
              type: 'boolean',
              description: 'Si es true, adjunta la imagen del mensaje actual del cliente (solo válido cuando el mensaje actual es una imagen).',
            },
          },
          required: ['channelName', 'message'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const channelName = ctx.args?.channelName as string;
    const message = ctx.args?.message as string;
    const attachCurrentImage = ctx.args?.attachCurrentImage === true;

    if (!channelName) throw new Error('sendToInternalChannel: falta channelName');
    if (!message) throw new Error('sendToInternalChannel: falta message');
    if (!ctx.nodeSession) throw new Error('sendToInternalChannel: no hay nodeSession activa');

    let imageUrl: string | undefined;
    if (attachCurrentImage) {
      if (!ctx.mediaRelativePath) {
        throw new Error('sendToInternalChannel: attachCurrentImage=true pero el mensaje actual no contiene imagen');
      }
      imageUrl = this.fileStorageService.buildDockerAccessibleUrl(ctx.mediaRelativePath);
    }

    await this.queueRequestService.enqueue({
      userId: ctx.tenantId,
      nodeSessionId: ctx.nodeSession.id,
      conversationId: ctx.conversationId,
      currentNodeId: ctx.nodeSession.currentNodeId!,
      instanceName: ctx.instanceName,
      label: channelName,
      message,
      imageUrl,
      isTest: ctx.isTest,
      toolName: 'sendToInternalChannel',
      toolContext: { channelName, attachCurrentImage },
    });

    await ctx.sessionStore.updateStatus(ctx.nodeSession.id, 'waiting_queue');
    ctx.sideEffects.push({ action: 'waitingQueue', args: { label: channelName } });

    this.logger.log(`sendToInternalChannel: encolado a "${channelName}"${imageUrl ? ' (con imagen)' : ''}${ctx.isTest ? ' [TEST]' : ''}`);

    return `Mensaje enviado a ${channelName}. Esperando respuesta.`;
  }
}
