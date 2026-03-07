import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { EvolutionService } from '@common/evolution/evolution.service';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { buildOutgoingMessageData } from '@common/utils/build-outgoing-message-data';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { NodeSessionRepository } from '../../repositories/node-session.repository';
import { TemplateRepository } from '../../repositories/template.repository';

@Injectable()
export class CloseSessionFn {
  private readonly logger = new Logger(CloseSessionFn.name);

  constructor(
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly templateRepo: TemplateRepository,
    private readonly evolutionService: EvolutionService,
    private readonly internalApi: InternalApiClient,
  ) {}

  @NodeFunction({
    code: 'closeSession',
    name: 'Cerrar sesión',
    description: 'Cierra la conversacion cuando el cliente se despide y HAY historial previo en la conversacion. Envia un mensaje de despedida y cierra la sesion.',
  })
  async execute(ctx: NodeContext): Promise<string> {
    // 1. Get farewell template
    const farewell = await this.templateRepo.findByCode('farewell', ctx.userId);

    // 2. Send farewell message via Evolution
    const response = await this.evolutionService.sendTextMessage(
      ctx.instanceName,
      ctx.clientPhone,
      farewell,
    );
    const evolutionKeyId = response.key.id;

    this.logger.log(
      `CloseSession: sent farewell to ${ctx.clientPhone}, keyId: ${evolutionKeyId}`,
    );

    // 3. Save message to DB
    const messageData = buildOutgoingMessageData(
      ctx.conversationId,
      MessageType.text,
      farewell,
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
        lastMessagePreview: farewell.substring(0, 100),
      },
    );

    // 4. Close node session
    await this.nodeSessionRepo.close(ctx.nodeSession.id);

    // 5. Close conversation (move messages to sub-conversation, mark analyzed)
    await this.internalApi.closeConversation(ctx.conversationId);

    this.logger.log(
      `CloseSession: closed node session ${ctx.nodeSession.id} and conversation ${ctx.conversationId}`,
    );

    return 'closed';
  }
}
