import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { EvolutionService } from '@common/evolution/evolution.service';
import { InternalApiClient } from '../../../ai/clients/internal-api.client';
import { buildOutgoingMessageData } from '@common/utils/build-outgoing-message-data';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { TemplateRepository } from '../../repositories/template.repository';

@Injectable()
export class CloseSessionFn {
  private readonly logger = new Logger(CloseSessionFn.name);

  constructor(
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
    const farewell = await this.templateRepo.findByCode('farewell', ctx.tenantId);

    if (!ctx.nodeSession) {
      throw new Error(
        `closeSession: nodeSession is null for conversation ${ctx.conversationId}. ` +
        `This tool should only be called when there is an active session.`,
      );
    }

    if (ctx.isTest) {
      ctx.sideEffects.push(
        { action: 'sendFarewell', args: { mensaje: farewell } },
        { action: 'closeNodeSession', args: { nodeSessionId: ctx.nodeSession.id } },
        { action: 'closeConversation', args: { conversationId: ctx.conversationId } },
      );
      await ctx.sessionStore.close(ctx.nodeSession.id);
      this.logger.log(`CloseSession [TEST]: farewell="${farewell.substring(0, 80)}"`);
      return 'closed';
    }

    // 1. Send farewell message via Evolution
    const response = await this.evolutionService.sendTextMessage(
      ctx.instanceName,
      ctx.clientPhone,
      farewell,
    );
    const evolutionKeyId = response.key.id;

    this.logger.log(
      `CloseSession: sent farewell to ${ctx.clientPhone}, keyId: ${evolutionKeyId}`,
    );

    // 2. Save message to DB
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
      ctx.tenantId,
      messageData,
      {
        lastMessageAt: new Date(),
        lastMessagePreview: farewell.substring(0, 100),
      },
    );

    // 3. Close node session
    await ctx.sessionStore.close(ctx.nodeSession.id);

    // 4. Close conversation (move messages to sub-conversation, mark analyzed)
    await this.internalApi.closeConversation(ctx.conversationId);

    this.logger.log(
      `CloseSession: closed node session ${ctx.nodeSession.id} and conversation ${ctx.conversationId}`,
    );

    return 'closed';
  }
}
