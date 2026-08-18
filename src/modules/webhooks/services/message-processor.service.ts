import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebhooksService } from '../webhooks.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from '../repositories/client.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { MessageRepository } from '../repositories/message.repository';
import { GroupConversationRepository } from '../repositories/group-conversation.repository';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { EvolutionService } from '@common/evolution/evolution.service';
import { ContactLabelService } from '@modules/queue-system/services/contact-label.service';
import { QueueRequestService } from '@modules/queue-system/services/queue-request.service';
import { MessageHistoryBootstrapService } from './message-history-bootstrap.service';
import type { EvolutionWebhookEvent } from '../types/evolution-webhook.types';
import type { EvolutionMessage } from '@common/evolution/evolution.service';

@Injectable()
export class MessageProcessorService {
  private readonly logger = new Logger(MessageProcessorService.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly phoneRepository: PhoneRepository,
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly groupConversationRepository: GroupConversationRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly evolutionService: EvolutionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly contactLabelService: ContactLabelService,
    private readonly queueRequestService: QueueRequestService,
    private readonly historyBootstrapService: MessageHistoryBootstrapService,
  ) {}

  /**
   * Procesa messages.upsert (individuales y grupos)
   */
  async processMessage(
    phoneId: string,
    instanceName: string,
    webhookData: EvolutionWebhookEvent<EvolutionMessage & { profilePicUrl?: string | null }>,
  ) {
    const fromMe = webhookData?.data?.key?.fromMe || false;
    const messageKey = webhookData?.data?.key;
    const remoteJid = webhookData?.data?.key?.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');

    this.logger.log(`[messages.upsert] remoteJid=${remoteJid} fromMe=${fromMe} type=${Object.keys(webhookData?.data?.message || {})[0] ?? 'unknown'}`);

    // Ignorar tipos de mensaje no procesables
    const rawMessage = webhookData?.data?.message || {};
    const ignoredTypes = ['reactionMessage', 'protocolMessage', 'pollUpdateMessage'];
    const ignoredType = ignoredTypes.find((t) => rawMessage[t]);
    if (ignoredType) {
      this.logger.log(`[messages.upsert] Ignored event type=${ignoredType} remoteJid=${remoteJid}`);
      return;
    }

    // Obtener phone (necesario para tenantId en media y scoping de eventos WS)
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(`Phone ${phoneId} not found`);
      return;
    }

    // Si es mensaje saliente (fromMe), esperar 300ms para evitar race condition con cache
    if (fromMe && messageKey) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const existingMessage = await this.messageRepository.findByMetadataKeyId(
        messageKey.id,
      );

      if (existingMessage) {
        this.websocketGateway.emit('message:sent', existingMessage, phone.tenantId);
        this.logger.log(
          `Message ${messageKey.id} already in DB, emitted to frontend`,
        );
        await this.conversationRepository.upsertStats(existingMessage.conversationId, 'outbound');
        return;
      }

      this.logger.log(`Message ${messageKey.id} from WhatsApp Web, saving`);
    }

    // Upsert Conversation (individual o grupo)
    let conversation: { id: string; mode: string; groupName?: string | null };
    let clientPhone: string | null = null;
    let clientName: string | null = null;
    const rawParticipant = webhookData?.data?.key?.participant || '';
    const participantAlt = webhookData?.data?.key?.participantAlt || '';
    const senderJid = rawParticipant.endsWith('@lid') && participantAlt
      ? participantAlt
      : rawParticipant;
    const senderPhone = senderJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    let senderName = webhookData?.data?.pushName || senderPhone;

    let senderProfilePicUrl: string | null = null;

    if (isGroup) {
      conversation = await this.groupConversationRepository.upsert({
        phoneId,
        groupJid: remoteJid,
      });

      if (!fromMe) {
        const sender = await this.clientRepository.upsert({ phoneNumber: senderPhone, name: senderName });
        await this.conversationRepository.upsertParticipant(conversation.id, sender.id);

        if (sender.name) senderName = sender.name;

        if (sender.profilePicUrl) {
          senderProfilePicUrl = sender.profilePicUrl;
        } else {
          const picUrl = await this.evolutionService.fetchProfilePictureUrl(instanceName, senderJid);
          if (picUrl) {
            await this.clientRepository.updateProfilePicIfExists(senderPhone, picUrl);
            senderProfilePicUrl = picUrl;
          }
        }
      }

      // Bootstrap historial si es conversación nueva
      const existingCount = await this.messageRepository.countByConversationId(conversation.id);
      if (existingCount === 0) {
        this.logger.log(
          `New group conversation ${conversation.id}, bootstrapping history from Evolution for ${remoteJid}`,
        );
        this.historyBootstrapService.bootstrapMessagesInBackground(
          conversation.id,
          instanceName,
          remoteJid,
          phone.tenantId,
        );
      }
    } else {
      const clientData = this.webhooksService.buildClientData(webhookData, fromMe);
      clientPhone = clientData.phoneNumber;
      const client = await this.clientRepository.upsert(clientData);
      clientName = client.name ?? null;
      const conversationData = this.webhooksService.buildConversationData(phoneId, client.id);
      conversation = await this.conversationRepository.upsertIndividual(conversationData);

      // Bootstrap historial si es conversación nueva (y no hubo cierre previo)
      const existingCount = await this.messageRepository.countByConversationId(conversation.id);
      if (existingCount === 0) {
        const closedCount = await this.conversationRepository.countClosedSubConversations(phoneId, client.id);
        if (closedCount > 0) {
          this.logger.log(
            `[bootstrap] Skipping — ${closedCount} closed sub-conversations exist for conversation ${conversation.id}`,
          );
        } else {
          const clientRemoteJid = `${clientData.phoneNumber}@s.whatsapp.net`;
          this.logger.log(
            `New conversation ${conversation.id}, bootstrapping history from Evolution for ${clientRemoteJid}`,
          );
          this.historyBootstrapService.bootstrapMessagesInBackground(
            conversation.id,
            instanceName,
            clientRemoteJid,
            phone.tenantId,
          );
        }
      }
    }

    // Si hay media, descargar ANTES de crear el mensaje
    let mediaData: {
      relativePath: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    } | null = null;
    const hasMedia = this.webhooksService.hasMedia(webhookData);

    this.logger.log(
      `[media] hasMedia=${hasMedia} isGroup=${isGroup} messageKey=${JSON.stringify(messageKey)}`,
    );

    if (hasMedia && messageKey) {
      try {
        this.logger.log(
          `[media] Attempting download instanceName=${instanceName} tenantId=${phone.tenantId} convId=${conversation.id} keyId=${messageKey.id} key=${JSON.stringify(messageKey)}`,
        );
        mediaData =
          await this.fileStorageService.downloadAndSaveMediaFromEvolution(
            this.evolutionService,
            instanceName,
            phone.tenantId,
            conversation.id,
            messageKey.id,
            messageKey,
          );
        this.logger.log(`[media] Downloaded OK: ${mediaData.relativePath}`);
      } catch (error) {
        this.logger.error(`[media] Failed to download: ${error.message} — stack: ${error.stack}`);
      }
    } else {
      this.logger.log(`[media] Skipped — hasMedia=${hasMedia} messageKey=${!!messageKey}`);
    }

    // Construir mensaje
    const groupMeta = isGroup && !fromMe ? { senderJid, senderName, senderProfilePicUrl } : null;
    if (groupMeta) {
      this.logger.log(`[group-meta] senderName=${groupMeta.senderName} senderProfilePicUrl=${groupMeta.senderProfilePicUrl ?? 'null'} senderJid=${groupMeta.senderJid}`);
    }

    const messageData = fromMe
      ? this.webhooksService.buildOutgoingMessageFromWebhook(webhookData, conversation.id, mediaData)
      : this.webhooksService.buildIncomingMessageData(webhookData, conversation.id, mediaData, groupMeta);

    // Guardar mensaje
    const message = await this.messageRepository.create(messageData);

    // Actualizar último mensaje de la conversación
    const conversationUpdate = this.webhooksService.buildConversationUpdate(message);
    await this.conversationRepository.updateLastMessage(conversation.id, conversationUpdate);

    // Actualizar stats (direction + unreadCount)
    // Solo incrementar unread si es mensaje entrante y la conversación está en modo hitl
    const direction = fromMe ? 'outbound' : 'inbound';
    const incrementUnread = direction === 'inbound' && conversation.mode === 'hitl';
    await this.conversationRepository.upsertStats(conversation.id, direction, incrementUnread);

    // Emitir al frontend
    if (fromMe) {
      this.websocketGateway.emit('message:sent', { ...message, fromExternal: true }, phone.tenantId);
      this.logger.log(`Outgoing message from WhatsApp Web for conversation ${conversation.id}`);
    } else {
      const conversationName = isGroup
        ? (conversation.groupName ?? null)
        : (clientName ?? senderName ?? null);
      this.websocketGateway.emit('message:incoming', {
        ...message,
        conversationName,
        senderName: isGroup ? senderName : null,
      }, phone.tenantId);
      this.logger.log(`Incoming message for conversation ${conversation.id}`);
    }

    // Si es mensaje entrante de grupo, verificar si hay un QueueRequest pendiente para ese grupo+sender
    if (!fromMe && isGroup) {
      const matched = await this.tryMatchQueueResponse(
        instanceName,
        senderPhone,
        message,
        `group ${remoteJid} sender ${senderPhone}`,
        remoteJid,
      );
      if (matched) return;
    }

    // Si es mensaje entrante individual, verificar si es contacto etiquetado (supervisor, etc.)
    if (!fromMe && !isGroup && clientPhone) {
      const isLabeled = await this.contactLabelService.isLabeledContact(clientPhone);

      if (isLabeled) {
        // Contactos etiquetados NUNCA van al flujo normal — su respuesta va al queue system
        const matched = await this.tryMatchQueueResponse(
          instanceName,
          clientPhone,
          message,
          `labeled contact ${clientPhone}`,
        );
        if (!matched) {
          this.logger.log(
            `[queue] Message from labeled contact ${clientPhone} but no pending QueueRequest found`,
          );
        }
        return;
      }

      // Si mode=AI, emitir evento para AI agent
      if (conversation.mode === 'AI') {
        let aiContent = message.content;

        const quotedKeyId = (message.metadata as { quotedMessageId?: string } | null)?.quotedMessageId ?? null;
        if (quotedKeyId) {
          const quotedMsg = await this.messageRepository.findByMetadataKeyId(quotedKeyId);
          if (quotedMsg) {
            const hasImage = !!quotedMsg.mediaUrl;
            const quotedDesc = hasImage
              ? `imagen${quotedMsg.content ? `: "${quotedMsg.content}"` : ''} [messageId:${quotedMsg.id}]`
              : `"${quotedMsg.content ?? ''}" [messageId:${quotedMsg.id}]`;
            aiContent = `${aiContent ?? ''}\n[El cliente está citando el mensaje: ${quotedDesc}]`.trim();
          }
        }

        this.eventEmitter.emit('ai.incoming.message', {
          messageId: message.id,
          conversationId: conversation.id,
          instanceName,
          clientPhone,
          tenantId: phone.tenantId,
          messageType: message.type,
          content: aiContent,
          mediaRelativePath: mediaData?.relativePath || null,
          mediaMetadata: mediaData
            ? { fileName: mediaData.fileName, mimeType: mediaData.mimeType }
            : null,
        });
        this.logger.log(
          `Emitted ai.incoming.message for conversation ${conversation.id}`,
        );
      }
    }
  }

  /**
   * Intenta hacer match del mensaje entrante contra un QueueRequest pendiente
   * (respuesta de un supervisor/agente esperada por el sistema de cola).
   * Emite 'queue.response.received' y loggea si hay match.
   * @returns true si hubo match (el llamador debe cortar el flujo normal)
   */
  private async tryMatchQueueResponse(
    instanceName: string,
    phone: string,
    message: { id: string; content: string; metadata: unknown },
    logLabel: string,
    remoteJid?: string,
  ): Promise<boolean> {
    const quotedMessageId = (message.metadata as { quotedMessageId?: string } | null)?.quotedMessageId ?? undefined;
    const queueRequest = await this.queueRequestService.handleResponse(
      instanceName,
      phone,
      message.content,
      remoteJid,
      quotedMessageId,
    );

    if (!queueRequest) return false;

    this.eventEmitter.emit('queue.response.received', {
      queueRequestId: queueRequest.id,
      messageId: message.id,
    });
    this.logger.log(`[queue] Response from ${logLabel} matched QueueRequest ${queueRequest.id}`);
    return true;
  }
}
