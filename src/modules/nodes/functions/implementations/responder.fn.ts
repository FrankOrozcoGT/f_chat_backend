import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { EvolutionService } from '@common/evolution/evolution.service';
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
    description: 'Envía un mensaje de texto al cliente.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'responder',
        description: 'Envía un mensaje al cliente.',
        parameters: {
          type: 'object',
          properties: {
            mensaje: {
              type: 'string',
              description: 'El mensaje a enviar al cliente.',
            },
          },
          required: ['mensaje'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const mensaje = ctx.toolCallArgs?.mensaje as string;
    if (!mensaje) {
      throw new Error('responder: "mensaje" es requerido pero no fue proporcionado');
    }

    // 1. Enviar vía Evolution
    const response = await this.evolutionService.sendTextMessage(
      ctx.instanceName,
      ctx.clientPhone,
      mensaje,
    );
    const evolutionKeyId = response.key.id;

    this.logger.log(
      `Responder: sent "${mensaje.substring(0, 80)}" to ${ctx.clientPhone}, keyId: ${evolutionKeyId}`,
    );

    // 2. Guardar en DB
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
      ctx.userId,
      messageData,
      {
        lastMessageAt: new Date(),
        lastMessagePreview: mensaje.substring(0, 100),
      },
    );

    return 'Mensaje enviado al cliente.';
  }
}
