import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { EvolutionService, EvolutionMediaType } from '@common/evolution/evolution.service';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { buildOutgoingMessageData } from '@common/utils/build-outgoing-message-data';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';

@Injectable()
export class ResponderFn {
  private readonly logger = new Logger(ResponderFn.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly internalApi: InternalApiClient,
  ) {}

  @NodeFunction({
    code: 'responder',
    name: 'Responder al cliente',
    description: 'Envía un mensaje de texto al cliente, opcionalmente con una imagen de producto.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'responder',
        description:
          'Envía un mensaje al cliente. Si el cliente pide ver un producto y tiene imageUrl, pásala para enviar la imagen junto al mensaje.',
        parameters: {
          type: 'object',
          properties: {
            mensaje: {
              type: 'string',
              description: 'El mensaje de texto a enviar al cliente.',
            },
            imageUrl: {
              type: 'string',
              description:
                'URL de imagen del producto (campo imageUrl del catálogo). Si se proporciona, se envía como imagen con el mensaje como caption.',
            },
          },
          required: ['mensaje'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const mensaje = ctx.args?.mensaje as string;
    const imageUrl = ctx.args?.imageUrl as string | undefined;

    if (!mensaje) {
      throw new Error('responder: "mensaje" es requerido pero no fue proporcionado');
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({ action: 'sendMessage', args: { mensaje, imageUrl } });
      this.logger.log(`Responder [TEST]: "${mensaje.substring(0, 80)}"${imageUrl ? ' + imagen' : ''}`);
      return 'Mensaje enviado al cliente.';
    }

    if (imageUrl) {
      // Enviar imagen con caption
      const response = await this.evolutionService.sendMediaMessage(
        ctx.instanceName,
        ctx.clientPhone,
        imageUrl,
        EvolutionMediaType.IMAGE,
        mensaje,
      );
      const evolutionKeyId = response.key.id;

      this.logger.log(`Responder: sent image ${imageUrl} to ${ctx.clientPhone}, keyId: ${evolutionKeyId}`);

      const messageData = buildOutgoingMessageData(
        ctx.conversationId,
        MessageType.image,
        mensaje,
        'pending',
        imageUrl,
        evolutionKeyId,
        null,
        null,
        'image/webp',
        'bot',
      );

      await this.internalApi.sendMessageTransaction(
        ctx.conversationId,
        ctx.tenantId,
        messageData,
        { lastMessageAt: new Date(), lastMessagePreview: `📷 ${mensaje.substring(0, 95)}` },
      );
    } else {
      // Enviar texto
      const response = await this.evolutionService.sendTextMessage(
        ctx.instanceName,
        ctx.clientPhone,
        mensaje,
      );
      const evolutionKeyId = response.key.id;

      this.logger.log(`Responder: sent "${mensaje.substring(0, 80)}" to ${ctx.clientPhone}, keyId: ${evolutionKeyId}`);

      const messageData = buildOutgoingMessageData(
        ctx.conversationId,
        MessageType.text,
        mensaje,
        'pending',
        null,
        evolutionKeyId,
        null,
        null,
        null,
        'bot',
      );

      await this.internalApi.sendMessageTransaction(
        ctx.conversationId,
        ctx.tenantId,
        messageData,
        { lastMessageAt: new Date(), lastMessagePreview: mensaje.substring(0, 100) },
      );
    }

    return 'Mensaje enviado al cliente.';
  }
}
