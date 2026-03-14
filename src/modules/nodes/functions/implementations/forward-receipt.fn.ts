import { Injectable, Logger } from '@nestjs/common';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { EvolutionService, EvolutionMediaType } from '@common/evolution/evolution.service';
import { ContactLabelService } from '@modules/queue-system/services/contact-label.service';

@Injectable()
export class ForwardReceiptFn {
  private readonly logger = new Logger(ForwardReceiptFn.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly contactLabelService: ContactLabelService,
  ) {}

  @NodeFunction({
    code: 'forwardReceipt',
    name: 'Reenviar comprobante al usuario',
    description:
      'El cliente envió un comprobante de pago (imagen). Se reenvía al WhatsApp personal del usuario para revisión. NO envía mensaje al cliente.',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'forwardReceipt',
        description:
          'El cliente envió su comprobante de pago (IMAGEN). Reenvía la imagen al usuario para que la revise. REQUISITO: solo llamar cuando el mensaje actual del cliente contiene una IMAGEN. Si no hay imagen, NO llamar esta función.',
        parameters: {
          type: 'object',
          properties: {
            clientName: {
              type: 'string',
              description: 'Nombre del cliente que envió el comprobante',
            },
            amount: {
              type: 'string',
              description: 'Monto esperado del pago',
            },
          },
          required: ['clientName'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const clientName = ctx.toolCallArgs?.clientName as string;
    const amount = ctx.toolCallArgs?.amount as string | undefined;

    if (!ctx.imageUrl) {
      throw new Error(
        'forwardReceipt: no hay imagen en el mensaje actual. El cliente debe enviar una imagen del comprobante.',
      );
    }

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'forwardReceipt',
        args: { clientName, amount, imageUrl: ctx.imageUrl },
      });
      this.logger.log(`forwardReceipt [TEST]: comprobante de ${clientName}`);
      return 'Comprobante reenviado al usuario para revisión.';
    }

    // Resolve the supervisor's remoteJid via ContactLabel
    const { remoteJid } = await this.contactLabelService.resolve(
      ctx.userId,
      'supervisor',
    );

    const caption = amount
      ? `Comprobante de ${clientName} — monto esperado: ${amount}`
      : `Comprobante de ${clientName}`;

    await this.evolutionService.sendMediaMessage(
      ctx.instanceName,
      remoteJid,
      ctx.imageUrl,
      EvolutionMediaType.IMAGE,
      caption,
    );

    this.logger.log(
      `forwardReceipt: comprobante de ${clientName} enviado a ${remoteJid}`,
    );

    return 'Comprobante reenviado al usuario para revisión.';
  }
}
