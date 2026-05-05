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

@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name);

  // Debounce timers para sync de contactos por phoneId
  private readonly syncDebounceTimers = new Map<string, NodeJS.Timeout>();
  // Contador acumulado de contactos por phoneId
  private readonly syncContactsCount = new Map<string, number>();

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
  ) {}

  /**
   * Procesa messages.upsert (individuales y grupos)
   */
  async processMessage(
    phoneId: string,
    instanceName: string,
    webhookData: any,
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

    // Si es mensaje saliente (fromMe), esperar 300ms para evitar race condition con cache
    if (fromMe && messageKey) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const existingMessage = await this.messageRepository.findByMetadataKeyId(
        messageKey.id,
      );

      if (existingMessage) {
        this.websocketGateway.emit('message:sent', existingMessage);
        this.logger.log(
          `Message ${messageKey.id} already in DB, emitted to frontend`,
        );
        await this.conversationRepository.upsertStats(existingMessage.conversationId, 'outbound');
        return;
      }

      this.logger.log(`Message ${messageKey.id} from WhatsApp Web, saving`);
    }

    // Obtener phone (necesario para userId en media)
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(`Phone ${phoneId} not found`);
      return;
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
        this.bootstrapMessagesInBackground(
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
      conversation = await this.conversationRepository.upsert(conversationData);

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
          this.bootstrapMessagesInBackground(
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
          `[media] Attempting download instanceName=${instanceName} userId=${phone.tenantId} convId=${conversation.id} keyId=${messageKey.id} key=${JSON.stringify(messageKey)}`,
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
      this.websocketGateway.emit('message:sent', { ...message, fromExternal: true });
      this.logger.log(`Outgoing message from WhatsApp Web for conversation ${conversation.id}`);
    } else {
      const conversationName = isGroup
        ? (conversation.groupName ?? null)
        : (clientName ?? senderName ?? null);
      this.websocketGateway.emit('message:incoming', {
        ...message,
        conversationName,
        senderName: isGroup ? senderName : null,
      });
      this.logger.log(`Incoming message for conversation ${conversation.id}`);
    }

    // Si es mensaje entrante de grupo, verificar si hay un QueueRequest pendiente para ese grupo+sender
    if (!fromMe && isGroup) {
      const quotedMessageId = (message.metadata as any)?.quotedMessageId ?? undefined;
      const queueRequest = await this.queueRequestService.handleResponse(
        instanceName,
        senderPhone,
        message.content,
        remoteJid,
        quotedMessageId,
      );
      if (queueRequest) {
        this.eventEmitter.emit('queue.response.received', {
          queueRequestId: queueRequest.id,
          messageId: message.id,
        });
        this.logger.log(`[queue] Response from group ${remoteJid} sender ${senderPhone} matched QueueRequest ${queueRequest.id}`);
        return;
      }
    }

    // Si es mensaje entrante individual, verificar si es contacto etiquetado (supervisor, etc.)
    if (!fromMe && !isGroup && clientPhone) {
      const isLabeled = await this.contactLabelService.isLabeledContact(clientPhone);

      if (isLabeled) {
        // Contactos etiquetados NUNCA van al flujo normal — su respuesta va al queue system
        const quotedMessageId = (message.metadata as any)?.quotedMessageId ?? undefined;
        const queueRequest = await this.queueRequestService.handleResponse(
          instanceName,
          clientPhone,
          message.content,
          undefined,
          quotedMessageId,
        );
        if (queueRequest) {
          this.eventEmitter.emit('queue.response.received', {
            queueRequestId: queueRequest.id,
            messageId: message.id,
          });
          this.logger.log(
            `[queue] Response from labeled contact ${clientPhone} matched QueueRequest ${queueRequest.id}`,
          );
        } else {
          this.logger.log(
            `[queue] Message from labeled contact ${clientPhone} but no pending QueueRequest found`,
          );
        }
        return;
      }

      // Si mode=AI, emitir evento para AI agent
      if (conversation.mode === 'AI') {
        let aiContent = message.content;

        const quotedKeyId = (message.metadata as any)?.quotedMessageId ?? null;
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
   * Procesa contacts.upsert — sync inicial de contactos en bulk
   */
  async syncContacts(
    phoneId: string,
    tenantId: string,
    webhookData: any,
  ) {
    const raw: Array<{ remoteJid?: string; pushName?: string; profilePicUrl?: string | null }> =
      Array.isArray(webhookData?.data) ? webhookData.data : [];

    const contacts = raw.filter((c) =>
      c.remoteJid?.endsWith('@s.whatsapp.net'),
    );

    this.logger.log(
      `[${new Date().toISOString()}] contacts.upsert phone=${phoneId} total=${raw.length} individual=${contacts.length}`,
    );

    // Resetear debounce
    const existingTimer = this.syncDebounceTimers.get(phoneId);
    if (existingTimer) clearTimeout(existingTimer);

    const resetTimer = setTimeout(() => {
      const finalCount = this.syncContactsCount.get(phoneId) ?? 0;
      this.syncDebounceTimers.delete(phoneId);
      this.syncContactsCount.delete(phoneId);
      this.websocketGateway.emit(
        'phone:sync_complete',
        { phoneId, contactsCount: finalCount },
        tenantId,
      );
      this.logger.log(
        `[${new Date().toISOString()}] phone:sync_complete phone=${phoneId} contactsCount=${finalCount}`,
      );
    }, 5000);

    this.syncDebounceTimers.set(phoneId, resetTimer);

    if (contacts.length === 0) return;

    // 1. Bulk insert clientes
    await this.clientRepository.createManySkipDuplicates(
      contacts.map((c) => ({
        phoneNumber: c.remoteJid!.replace('@s.whatsapp.net', ''),
        name: c.pushName || c.remoteJid!.replace('@s.whatsapp.net', ''),
        profilePicUrl: c.profilePicUrl || null,
      })),
    );

    // 2. Obtener IDs y bulk insert conversaciones
    const phoneNumbers = contacts.map((c) =>
      c.remoteJid!.replace('@s.whatsapp.net', ''),
    );
    const clients =
      await this.clientRepository.findManyByPhoneNumbers(phoneNumbers);
    const phoneToClientId = new Map(clients.map((c) => [c.phoneNumber, c.id]));

    const conversationsData = contacts
      .map((c) => {
        const phoneNumber = c.remoteJid!.replace('@s.whatsapp.net', '');
        const clientId = phoneToClientId.get(phoneNumber);
        return clientId ? { phoneId, clientId } : null;
      })
      .filter((d): d is { phoneId: string; clientId: string } => d !== null);

    await this.conversationRepository.createManySkipDuplicates(
      conversationsData,
    );

    // 2b. Bulk insert ConversationParticipants
    const conversations = await this.conversationRepository.findManyByPhoneIdAndClientIds(
      phoneId,
      conversationsData.map((d) => d.clientId),
    );
    await this.conversationRepository.createManyParticipantsSkipDuplicates(
      conversations
        .filter((c): c is { id: string; clientId: string } => c.clientId !== null)
        .map((c) => ({ conversationId: c.id, clientId: c.clientId })),
    );

    // 3. Acumular contador y emitir progreso
    const prev = this.syncContactsCount.get(phoneId) ?? 0;
    const total = prev + contacts.length;
    this.syncContactsCount.set(phoneId, total);

    this.websocketGateway.emit(
      'phone:sync_progress',
      { phoneId, contactsCount: total },
      tenantId,
    );

    this.logger.log(
      `[${new Date().toISOString()}] phone:sync_progress phone=${phoneId} contactsCount=${total}`,
    );
  }

  /**
   * Procesa groups.upsert — metadata de grupos
   */
  async syncGroup(
    phoneId: string,
    instanceName: string,
    webhookData: any,
  ) {
    const groups: any[] = Array.isArray(webhookData?.data) ? webhookData.data : [webhookData?.data];
    const validGroups = groups.filter((g) => g?.id);

    // Bulk delete comunidades que chats.set pudo haber creado
    const communityJids = validGroups
      .filter((g) => g.isCommunity === true)
      .map((g) => g.id as string);

    if (communityJids.length > 0) {
      const deleted = await this.groupConversationRepository.deleteManyByGroupJids(communityJids);
      this.logger.log(`[groups.upsert] Deleted ${deleted} communities: ${communityJids.join(', ')}`);
    }

    // Procesar solo grupos reales
    const realGroups = validGroups.filter((g) => g.isCommunity !== true);

    for (const group of realGroups) {
      const groupJid = group.id;
      const groupName = group.subject || null;
      const groupPictureUrl = group.pictureUrl || null;
      const participants: { id: string }[] = group.participants || [];

      this.logger.log(`[groups.upsert] groupJid=${groupJid} groupName=${groupName} pictureUrl=${groupPictureUrl} participants=${participants.length} keys=${Object.keys(group).join(',')}`);

      const conversation = await this.groupConversationRepository.upsert({ phoneId, groupJid, groupName: groupName || undefined });

      const pictureUrl = await this.evolutionService.fetchProfilePictureUrl(instanceName, groupJid);
      this.logger.log(`[groups.upsert] fetchProfilePictureUrl result for ${groupJid}: ${pictureUrl}`);
      await this.groupConversationRepository.updateGroupInfo(groupJid, {
        groupName: groupName || undefined,
        groupPictureUrl: pictureUrl ?? groupPictureUrl,
      });

      for (const p of participants) {
        if (p.id.endsWith('@lid')) {
          this.logger.warn(`[groups.upsert] LID participant in group ${groupJid} — full object: ${JSON.stringify(p)}`);
          continue;
        }
        const phoneNumber = p.id.replace('@s.whatsapp.net', '').replace('@c.us', '');
        if (!phoneNumber) continue;
        const client = await this.clientRepository.upsert({ phoneNumber, name: phoneNumber });
        await this.conversationRepository.upsertParticipant(conversation.id, client.id);
      }
    }
  }

  /**
   * Procesa chats.set — sync inicial de grupos con nombre
   */
  async syncChats(phoneId: string, webhookData: any) {
    const chats: any[] = Array.isArray(webhookData?.data) ? webhookData.data : [];
    const groups = chats.filter((c) => c.remoteJid?.endsWith('@g.us'));
    this.logger.log(`[chats.set] total=${chats.length} groups=${groups.length}`);
    if (groups.length === 0) return;

    for (const group of groups) {
      const groupJid = group.remoteJid;
      const groupName = group.name || null;
      this.logger.log(`[chats.set] upsert groupJid=${groupJid} groupName=${groupName}`);
      await this.groupConversationRepository.upsert({ phoneId, groupJid, groupName: groupName || undefined });
    }
    this.logger.log(`[chats.set] done groups=${groups.length}`);
  }

  /**
   * Bootstrap de mensajes en background (fire-and-forget)
   */
  private async bootstrapMessagesInBackground(
    conversationId: string,
    instanceName: string,
    remoteJid: string,
    userId: string,
  ) {
    try {
      const isGroupConversation = remoteJid.endsWith('@g.us');

      const [rawMessages, groupPictureUrl] = await Promise.all([
        this.evolutionService.findMessages(instanceName, remoteJid),
        isGroupConversation
          ? this.evolutionService.fetchProfilePictureUrl(instanceName, remoteJid)
          : Promise.resolve(null),
      ]);

      if (isGroupConversation && groupPictureUrl) {
        await this.groupConversationRepository.updateGroupInfo(remoteJid, { groupPictureUrl });
      }

      if (rawMessages.length === 0) return;

      // Deduplicar
      const existingKeyIds =
        await this.messageRepository.findKeyIdsByConversationId(conversationId);
      const newMessages = rawMessages
        .filter((m) => m.key?.id && !existingKeyIds.has(m.key.id))
        .sort((a, b) => (b.messageTimestamp ?? 0) - (a.messageTimestamp ?? 0));

      if (newMessages.length === 0) return;

      const ignoredTypes = ['reactionMessage', 'protocolMessage', 'pollUpdateMessage'];

      // Mapeo LID → phoneNumber → Client para grupos
      let lidToClientMap = new Map<string, { phoneNumber: string; name: string | null; profilePicUrl: string | null }>();
      if (isGroupConversation) {
        const participants = await this.evolutionService.fetchGroupParticipants(instanceName, remoteJid);
        const lidToPhone = new Map<string, string>();
        for (const p of participants) {
          if (p.phoneNumber) {
            const lid = p.id.replace('@lid', '');
            const phone = p.phoneNumber.replace('@s.whatsapp.net', '').replace('@c.us', '');
            lidToPhone.set(lid, phone);
          }
        }

        const phoneNumbers = [...new Set(lidToPhone.values())];
        if (phoneNumbers.length > 0) {
          const clients = await this.clientRepository.findManyByPhoneNumbers(phoneNumbers);
          const clientByPhone = new Map(clients.map((c) => [c.phoneNumber, c]));

          const phonesWithoutPic = phoneNumbers.filter((p) => !clientByPhone.get(p)?.profilePicUrl);
          for (const ph of phonesWithoutPic) {
            const picUrl = await this.evolutionService.fetchProfilePictureUrl(instanceName, `${ph}@s.whatsapp.net`);
            if (picUrl) {
              await this.clientRepository.updateProfilePicIfExists(ph, picUrl);
              const existing = clientByPhone.get(ph);
              if (existing) existing.profilePicUrl = picUrl;
            }
          }

          for (const [lid, phone] of lidToPhone) {
            const client = clientByPhone.get(phone);
            lidToClientMap.set(lid, {
              phoneNumber: phone,
              name: client?.name || null,
              profilePicUrl: client?.profilePicUrl || null,
            });
          }
        }
        this.logger.log(`[bootstrap] lidToClientMap: ${lidToClientMap.size} entries`);
      }

      for (const m of newMessages) {
        const rawMsg = m.message || {};
        const ignoredType = ignoredTypes.find((t) => rawMsg[t]);
        if (ignoredType) continue;

        const { type, content, hasMedia } =
          this.evolutionService.parseMessageContent(rawMsg);
        let mediaData: {
          relativePath: string;
          fileName: string;
          fileSize: number;
          mimeType: string;
        } | null = null;

        if (hasMedia && m.key?.id) {
          try {
            mediaData =
              await this.fileStorageService.downloadAndSaveMediaFromEvolution(
                this.evolutionService,
                instanceName,
                userId,
                conversationId,
                m.key.id,
                m.key,
              );
            this.websocketGateway.emit(
              'message:media_ready',
              {
                id: m.key.id,
                conversationId,
                mediaUrl: mediaData.relativePath,
              },
              userId,
            );
          } catch (err) {
            this.logger.warn(
              `Failed to download media for keyId ${m.key.id}: ${err.message}`,
            );
          }
        }

        await this.messageRepository.create({
          conversationId,
          type,
          content,
          mediaUrl: mediaData?.relativePath || null,
          fileName: mediaData?.fileName || null,
          fileSize: mediaData?.fileSize || null,
          mimeType: mediaData?.mimeType || null,
          direction: m.key?.fromMe ? 'outgoing' : 'incoming',
          senderType: m.key?.fromMe ? 'agent' : 'client',
          status: 'delivered',
          metadata: (() => {
            const meta: Record<string, any> = { keyId: m.key?.id };
            if (isGroupConversation && !m.key?.fromMe && m.pushName) {
              const clientInfo = lidToClientMap.get(m.pushName);
              if (clientInfo) {
                meta.senderJid = `${clientInfo.phoneNumber}@s.whatsapp.net`;
                meta.senderName = clientInfo.name || clientInfo.phoneNumber;
                if (clientInfo.profilePicUrl) meta.senderProfilePicUrl = clientInfo.profilePicUrl;
              } else {
                meta.senderName = m.pushName;
              }
            } else if (m.pushName) {
              meta.senderName = m.pushName;
            }
            const quotedStanzaId = this.webhooksService.extractQuotedStanzaId(
              m.message || {},
            );
            if (quotedStanzaId) meta.quotedMessageId = quotedStanzaId;
            return meta;
          })(),
          createdAt: m.messageTimestamp
            ? new Date(m.messageTimestamp * 1000)
            : undefined,
        });
      }

      this.logger.log(
        `Background: bootstrapped conversation ${conversationId} with ${newMessages.length} messages`,
      );
    } catch (err) {
      this.logger.error(`Background bootstrap failed for ${conversationId} (remoteJid=${remoteJid}): ${err.message}`, err.stack);
      throw err;
    }
  }
}
