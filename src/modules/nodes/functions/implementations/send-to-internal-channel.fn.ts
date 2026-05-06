import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { PostCodeRetryError } from '../node-function.errors';
import { QueueRequestService } from '@modules/queue-system/services/queue-request.service';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { InternalApiClient } from '@modules/ai/clients/internal-api.client';
import { EvolutionService } from '@common/evolution/evolution.service';
import { buildOutgoingMessageData } from '@common/utils/build-outgoing-message-data';

@Injectable()
export class SendToInternalChannelFn {
  private readonly logger = new Logger(SendToInternalChannelFn.name);

  constructor(
    private readonly queueRequestService: QueueRequestService,
    private readonly fileStorageService: FileStorageService,
    private readonly internalApi: InternalApiClient,
    private readonly evolutionService: EvolutionService,
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
              description: 'ID del mensaje que contiene la imagen a adjuntar. El ID aparece como [messageId:XXX] en el contenido del mensaje actual o en el historial. Usa únicamente el valor XXX (sin el prefijo "messageId:").',
            },
            clientMessage: {
              type: 'string',
              description: 'Mensaje opcional para enviar al cliente antes de pausar la conversación. Úsalo para informarle que su solicitud está siendo procesada.',
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
    const clientMessage = ctx.args?.clientMessage as string | undefined;

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

    // Enviar mensaje informativo al cliente antes de pausar (si se proporcionó)
    if (clientMessage && !ctx.isTest) {
      const evoResponse = await this.evolutionService.sendTextMessage(
        ctx.instanceName,
        ctx.clientPhone,
        clientMessage,
      );
      const messageData = buildOutgoingMessageData(
        ctx.conversationId,
        MessageType.text,
        clientMessage,
        'pending',
        null,
        evoResponse.key.id,
        null,
        null,
        null,
        'bot',
      );
      await this.internalApi.sendMessageTransaction(
        ctx.conversationId,
        ctx.tenantId,
        messageData,
        { lastMessageAt: new Date(), lastMessagePreview: clientMessage.substring(0, 100) },
      );
      this.logger.log(`sendToInternalChannel: client notified — "${clientMessage.substring(0, 60)}"`);
    } else if (clientMessage && ctx.isTest) {
      ctx.sideEffects.push({ action: 'notifyClient', args: { message: clientMessage } });
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
