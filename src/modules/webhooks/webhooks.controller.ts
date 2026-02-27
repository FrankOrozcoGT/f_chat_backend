import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebhooksService } from './webhooks.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from './repositories/client.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';
import { GroupConversationRepository } from './repositories/group-conversation.repository';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { EvolutionService } from '@common/evolution/evolution.service';

@Controller('whatsapp/webhook')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

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
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() webhookData: any) {
    const event = webhookData.event;
    const instanceId = webhookData.instance;

    // Buscar phone por evolutionInstanceId
    const phone =
      await this.phoneRepository.findByEvolutionInstanceId(instanceId);
    if (!phone) {
      this.logger.warn(
        `Phone not found for instance ${instanceId}, ignoring webhook`,
      );
      return { message: 'Phone not found, ignoring webhook' };
    }

    // Procesar según evento
    switch (event) {
      case 'qrcode.updated':
        await this.handleQrCodeUpdated(phone.id, webhookData);
        break;

      case 'connection.update':
        await this.handleConnectionUpdate(phone.id, webhookData);
        break;

      case 'messages.upsert':
      case 'send.message':
        await this.handleMessagesUpsert(phone.id, instanceId, webhookData);
        break;

      case 'messages.update':
        await this.handleMessagesUpdate(phone.id, instanceId, webhookData);
        break;

      case 'messages.set':
        await this.handleMessagesSet(phone.id, webhookData);
        break;

      case 'contacts.update':
        await this.handleContactsUpdate(webhookData);
        break;

      case 'contacts.upsert':
        await this.handleContactsUpsert(phone.id, phone.userId, webhookData);
        break;

      case 'chats.set':
        await this.handleChatsSet(phone.id, webhookData);
        break;

      case 'groups.upsert':
        await this.handleGroupsUpsert(phone.id, webhookData);
        break;

      default:
        this.logger.log(
          `[${new Date().toISOString()}] [Webhook] Unhandled event: ${event} - data: ${JSON.stringify(webhookData?.data).substring(0, 200)}`,
        );
        break;
    }

    return { message: 'Webhook processed' };
  }

  /**
   * Maneja evento QRCODE_UPDATED
   */
  private async handleQrCodeUpdated(phoneId: string, webhookData: any) {
    const qrCode = this.webhooksService.parseQrCode(webhookData);

    // Obtener phone para saber el userId
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(
        `Phone ${phoneId} not found, cannot emit WebSocket event`,
      );
      return;
    }

    this.logger.log(
      `[${new Date().toISOString()}] phone:qr_updated phone=${phoneId} userId=${phone.userId}`,
    );

    this.websocketGateway.emit(
      'phone:qr_updated',
      { phoneId, qrCode },
      phone.userId,
    );
  }

  /**
   * Maneja evento CONNECTION_UPDATE
   */
  private async handleConnectionUpdate(phoneId: string, webhookData: any) {
    const { status } = this.webhooksService.parseConnectionStatus(webhookData);

    const lastConnected = status === 'connected' ? new Date() : undefined;
    await this.phoneRepository.updateStatus(phoneId, status, lastConnected);

    // Obtener phone para saber el userId
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(
        `[${new Date().toISOString()}] Phone ${phoneId} not found, cannot emit WebSocket event`,
      );
      return;
    }

    this.logger.log(
      `[${new Date().toISOString()}] phone:status_changed phone=${phoneId} userId=${phone.userId} status=${status}`,
    );

    this.websocketGateway.emit(
      'phone:status_changed',
      { phoneId, status },
      phone.userId,
    );

    // Si conectó, avisar al frontend que empieza el sync
    if (status === 'connected') {
      this.syncContactsCount.set(phoneId, 0);
      this.websocketGateway.emit(
        'phone:syncing',
        { phoneId, contactsCount: 0 },
        phone.userId,
      );
      this.logger.log(
        `[${new Date().toISOString()}] phone:syncing emitted for phone=${phoneId}`,
      );
    }
  }

  /**
   * Maneja evento MESSAGES_UPSERT (individuales y grupos)
   */
  private async handleMessagesUpsert(
    phoneId: string,
    instanceName: string,
    webhookData: any,
  ) {
    const fromMe = webhookData?.data?.key?.fromMe || false;
    const messageKey = webhookData?.data?.key;
    const remoteJid = webhookData?.data?.key?.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');

    // 0. Log evento completo para debug
    this.logger.log(`[messages.upsert] FULL_EVENT remoteJid=${remoteJid} fromMe=${fromMe} data=${JSON.stringify(webhookData?.data)}`);

    // Ignorar tipos de mensaje no procesables
    const rawMessage = webhookData?.data?.message || {};
    const ignoredTypes = ['reactionMessage', 'protocolMessage', 'pollUpdateMessage'];
    const ignoredType = ignoredTypes.find((t) => rawMessage[t]);
    if (ignoredType) {
      this.logger.log(`[messages.upsert] Ignored event type=${ignoredType} remoteJid=${remoteJid}`);
      return;
    }

    // 1. Si es mensaje saliente (fromMe), esperar 300ms para evitar race condition
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
        return;
      }

      this.logger.log(`Message ${messageKey.id} from WhatsApp Web, saving`);
    }

    // 2. Obtener phone (necesario para userId en media)
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      this.logger.warn(`Phone ${phoneId} not found`);
      return;
    }

    // 3. Upsert Conversation (individual o grupo)
    let conversation: { id: string; mode: string };
    let clientPhone: string | null = null;
    const rawParticipant = webhookData?.data?.key?.participant || '';
    const participantAlt = webhookData?.data?.key?.participantAlt || '';
    const senderJid = rawParticipant.endsWith('@lid') && participantAlt
      ? participantAlt
      : rawParticipant;
    const senderPhone = senderJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    const senderName = webhookData?.data?.pushName || senderPhone;

    if (isGroup) {
      conversation = await this.groupConversationRepository.upsert({
        phoneId,
        groupJid: remoteJid,
      });

      // Upsert sender como Client y ConversationParticipant (solo si no soy yo)
      if (!fromMe) {
        const sender = await this.clientRepository.upsert({ phoneNumber: senderPhone, name: senderName });
        await this.conversationRepository.upsertParticipant(conversation.id, sender.id);
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
          phone.userId,
        );
      }
    } else {
      const clientData = this.webhooksService.buildClientData(webhookData, fromMe);
      clientPhone = clientData.phoneNumber;
      const client = await this.clientRepository.upsert(clientData);
      const conversationData = this.webhooksService.buildConversationData(phoneId, client.id);
      conversation = await this.conversationRepository.upsert(conversationData);

      // Bootstrap historial si es conversación nueva
      const existingCount = await this.messageRepository.countByConversationId(conversation.id);
      if (existingCount === 0) {
        const clientRemoteJid = `${clientData.phoneNumber}@s.whatsapp.net`;
        this.logger.log(
          `New conversation ${conversation.id}, bootstrapping history from Evolution for ${clientRemoteJid}`,
        );
        this.bootstrapMessagesInBackground(
          conversation.id,
          instanceName,
          clientRemoteJid,
          phone.userId,
        );
      }
    }

    // 4. Si hay media, descargar ANTES de crear el mensaje
    let mediaData: {
      relativePath: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    } | null = null;
    const hasMedia = this.webhooksService.hasMedia(webhookData);

    this.logger.log(
      `[media] hasMedia=${hasMedia} isGroup=${isGroup} messageKey=${JSON.stringify(messageKey)} rawMessage=${JSON.stringify(webhookData?.data?.message)}`,
    );

    if (hasMedia && messageKey) {
      try {
        this.logger.log(
          `[media] Attempting download instanceName=${instanceName} userId=${phone.userId} convId=${conversation.id} keyId=${messageKey.id} key=${JSON.stringify(messageKey)}`,
        );
        mediaData =
          await this.fileStorageService.downloadAndSaveMediaFromEvolution(
            this.evolutionService,
            instanceName,
            phone.userId,
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

    // 5. Construir mensaje
    const groupMeta = isGroup && !fromMe ? { senderJid, senderName } : null;

    const messageData = fromMe
      ? this.webhooksService.buildOutgoingMessageFromWebhook(webhookData, conversation.id, mediaData)
      : this.webhooksService.buildIncomingMessageData(webhookData, conversation.id, mediaData, groupMeta);

    // 6. Guardar mensaje
    const message = await this.messageRepository.create(messageData);

    // 7. Actualizar último mensaje de la conversación
    const conversationUpdate = this.webhooksService.buildConversationUpdate(message);
    await this.conversationRepository.updateLastMessage(conversation.id, conversationUpdate);

    // 8. Emitir al frontend
    if (fromMe) {
      this.websocketGateway.emit('message:sent', { ...message, fromExternal: true });
      this.logger.log(`Outgoing message from WhatsApp Web for conversation ${conversation.id}`);
    } else {
      this.websocketGateway.emit('message:incoming', message);
      this.logger.log(`Incoming message for conversation ${conversation.id}`);
    }

    // 9. Si mode=AI y es mensaje entrante individual, emitir evento para AI agent
    if (!fromMe && !isGroup && conversation.mode === 'AI') {
      this.eventEmitter.emit('ai.incoming.message', {
        messageId: message.id,
        conversationId: conversation.id,
        instanceName,
        clientPhone,
        userId: phone.userId,
        messageType: message.type,
        content: message.content,
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

  /** @deprecated Usar bootstrapMessagesInBackground */
  private async bootstrapConversationInBackground(
    phone: { id: string; userId: string; instanceName: string },
    phoneNumber: string,
    clientName: string,
    instanceName: string,
    remoteJid: string,
  ) {
    const client = await this.clientRepository.upsert({ phoneNumber, name: clientName });
    const conversation = await this.conversationRepository.upsert({
      phoneId: phone.id,
      clientId: client.id,
      isActive: true,
    });
    return this.bootstrapMessagesInBackground(conversation.id, instanceName, remoteJid, phone.userId);
  }

  private async bootstrapMessagesInBackground(
    conversationId: string,
    instanceName: string,
    remoteJid: string,
    userId: string,
  ) {
    try {
      const rawMessages = await this.evolutionService.findMessages(
        instanceName,
        remoteJid,
      );
      if (rawMessages.length === 0) return;

      // Deduplicar
      const existingKeyIds =
        await this.messageRepository.findKeyIdsByConversationId(conversationId);
      const newMessages = rawMessages
        .filter((m) => m.key?.id && !existingKeyIds.has(m.key.id))
        .sort((a, b) => (b.messageTimestamp ?? 0) - (a.messageTimestamp ?? 0));

      if (newMessages.length === 0) return;

      const ignoredTypes = ['reactionMessage', 'protocolMessage', 'pollUpdateMessage'];

      for (const m of newMessages) {
        // Filtrar tipos no procesables (igual que handleMessagesUpsert)
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
      this.logger.error(`Background bootstrap failed: ${err.message}`);
    }
  }

  /**
   * Maneja evento MESSAGES_SET
   * Notifica al frontend el progreso de sincronización del historial
   */
  private async handleMessagesSet(phoneId: string, webhookData: any) {
    const isLatest: boolean = webhookData?.data?.isLatest ?? false;
    const progress: number = webhookData?.data?.progress ?? 0;
    this.logger.log(
      `[${new Date().toISOString()}] messages.set phone=${phoneId} progress=${progress} isLatest=${isLatest}`,
    );

    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) return;

    this.websocketGateway.emit(
      'phone:sync_progress',
      { phoneId, progress, isLatest },
      phone.userId,
    );

    this.logger.log(
      `Sync progress for phone ${phoneId}: ${progress}% - isLatest: ${isLatest}`,
    );
  }

  /**
   * Maneja evento MESSAGES_UPDATE
   * Actualiza el status de mensajes (sent, delivered, read, failed)
   */
  private async handleMessagesUpdate(
    phoneId: string,
    instanceName: string,
    webhookData: any,
  ) {
    const data = webhookData?.data;

    if (!data) {
      this.logger.warn('messages.update: missing data');
      return;
    }

    const keyId = data.keyId; // ID del mensaje de WhatsApp (Evolution API)
    const status = data.status; // STRING: "SERVER_ACK", "DELIVERY_ACK", "READ", etc.
    const fromMe = data.fromMe;

    this.logger.log(
      `messages.update: keyId=${keyId}, status=${status}, fromMe=${fromMe}`,
    );

    // Solo procesar mensajes salientes (fromMe: true)
    if (!fromMe) {
      return;
    }

    // Mapear status de Evolution API (STRING) a nuestro enum
    let mappedStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

    switch (status) {
      case 'ERROR':
      case 'PENDING':
        mappedStatus = 'failed';
        break;
      case 'SERVER_ACK':
        mappedStatus = 'sent';
        break;
      case 'DELIVERY_ACK':
        mappedStatus = 'delivered';
        break;
      case 'READ':
      case 'PLAYED':
        mappedStatus = 'read';
        break;
      default:
        this.logger.warn(`Unknown status string: ${status}`);
        return;
    }

    this.logger.log(`Mapped status '${status}' to '${mappedStatus}'`);

    // Buscar mensaje por keyId en metadata
    try {
      const updatedMessage = await this.messageRepository.updateStatusByKeyId(
        keyId,
        mappedStatus,
      );

      if (!updatedMessage) {
        this.logger.warn(`Message with keyId ${keyId} not found in database`);
        return;
      }

      // Obtener phone para saber el userId
      const phone = await this.phoneRepository.findById(phoneId);
      if (!phone) {
        this.logger.warn(`Phone ${phoneId} not found, cannot emit WebSocket`);
        return;
      }

      // Emitir evento WebSocket al usuario dueño del phone
      this.websocketGateway.emit(
        'message:status_updated',
        {
          messageId: updatedMessage.id,
          conversationId: updatedMessage.conversationId,
          status: mappedStatus,
        },
        phone.userId,
      );

      this.logger.log(
        `Message ${updatedMessage.id} updated to '${mappedStatus}' and WebSocket emitted`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update message with keyId ${keyId}: ${error.message}`,
      );
    }
  }

  /**
   * Maneja evento CONTACTS_UPSERT
   * Persiste contactos individuales en bulk durante el sync inicial
   * Emite phone:sync_progress por batch y phone:sync_complete con debounce de 2s
   */
  private async handleContactsUpsert(
    phoneId: string,
    userId: string,
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

    // Resetear debounce siempre — incluso si no hay contactos individuales,
    // para no emitir sync_complete mientras aún llegan batches
    const existingTimer = this.syncDebounceTimers.get(phoneId);
    if (existingTimer) clearTimeout(existingTimer);

    const resetTimer = setTimeout(() => {
      const finalCount = this.syncContactsCount.get(phoneId) ?? 0;
      this.syncDebounceTimers.delete(phoneId);
      this.syncContactsCount.delete(phoneId);
      this.websocketGateway.emit(
        'phone:sync_complete',
        { phoneId, contactsCount: finalCount },
        userId,
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
      userId,
    );

    this.logger.log(
      `[${new Date().toISOString()}] phone:sync_progress phone=${phoneId} contactsCount=${total}`,
    );
  }

  /**
   * Maneja evento CONTACTS_UPDATE
   * Actualiza profilePicUrl en nuestra DB solo si el cliente ya existe
   */
  private async handleContactsUpdate(webhookData: any) {
    const contacts = Array.isArray(webhookData?.data)
      ? webhookData.data
      : [webhookData?.data];

    for (const contact of contacts) {
      const remoteJid = contact?.remoteJid;
      const profilePicUrl = contact?.profilePicUrl;

      if (
        !remoteJid ||
        !profilePicUrl ||
        !remoteJid.endsWith('@s.whatsapp.net')
      )
        continue;

      const phoneNumber = remoteJid.replace('@s.whatsapp.net', '');
      const updated = await this.clientRepository.updateProfilePicIfExists(
        phoneNumber,
        profilePicUrl,
      );

      if (updated.count > 0) {
        this.logger.log(
          `[contacts.update] Updated profilePicUrl for ${phoneNumber}`,
        );
      }
    }
  }

  /**
   * Maneja evento CHATS_SET
   * Llega durante el sync inicial con lista de chats (incluye grupos con nombre)
   */
  private async handleChatsSet(phoneId: string, webhookData: any) {
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
   * Maneja evento GROUPS_UPSERT
   * Evolution manda metadata del grupo: nombre, foto, participantes
   */
  private async handleGroupsUpsert(phoneId: string, webhookData: any) {
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

      this.logger.log(`[groups.upsert] groupJid=${groupJid} groupName=${groupName} participants=${participants.length}`);

      const conversation = await this.groupConversationRepository.upsert({ phoneId, groupJid, groupName: groupName || undefined });
      await this.groupConversationRepository.updateGroupInfo(groupJid, { groupName: groupName || undefined, groupPictureUrl });

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
}
