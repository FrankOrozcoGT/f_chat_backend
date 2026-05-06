import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { PostCodeRetryError } from '../node-function.errors';
import { QueueRequestService } from '@modules/queue-system/services/queue-request.service';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { InternalApiClient } from '@modules/ai/clients/internal-api.client';

@Injectable()
export class SendToInternalChannelFn {
  private readonly logger = new Logger(SendToInternalChannelFn.name);

  constructor(
    private readonly queueRequestService: QueueRequestService,
    private readonly fileStorageService: FileStorageService,
    private readonly internalApi: InternalApiClient,
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
            imageMessageId: {
              type: 'string',
              description: 'ID del mensaje que contiene la imagen a adjuntar. Cada mensaje con imagen muestra [messageId:xxx] en su contenido — tanto en el historial como en el mensaje actual. Copia ese ID exacto aquí cuando necesites reenviar la imagen al canal interno.',
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
    const imageMessageId = ctx.args?.imageMessageId as string | undefined;

    if (!channelName) throw new Error('sendToInternalChannel: falta channelName');
    if (!message) throw new Error('sendToInternalChannel: falta message');
    if (!ctx.nodeSession) throw new Error('sendToInternalChannel: no hay nodeSession activa');

    let imageUrl: string | undefined;
    if (imageMessageId) {
      this.logger.log(`sendToInternalChannel: buscando imagen messageId="${imageMessageId}"`);
      const msg = await this.internalApi.getMessageById(imageMessageId);
      this.logger.log(`sendToInternalChannel: getMessageById result=${JSON.stringify(msg)}`);
      if (!msg?.mediaUrl) {
        throw new PostCodeRetryError(
          `No se encontró imagen con messageId="${imageMessageId}". Revisa el historial y usa el messageId correcto del mensaje que contiene la imagen del comprobante.`,
        );
      }
      imageUrl = this.fileStorageService.buildDockerAccessibleUrl(msg.mediaUrl);
      this.logger.log(`sendToInternalChannel: imageUrl="${imageUrl}"`);
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
      toolContext: { channelName, imageMessageId },
    });

    await ctx.sessionStore.updateStatus(ctx.nodeSession.id, 'waiting_queue');
    ctx.sideEffects.push({ action: 'waitingQueue', args: { label: channelName } });

    this.logger.log(`sendToInternalChannel: encolado a "${channelName}"${imageUrl ? ' (con imagen)' : ''}${ctx.isTest ? ' [TEST]' : ''}`);

    return `Mensaje enviado a ${channelName}. Esperando respuesta.`;
  }
}
