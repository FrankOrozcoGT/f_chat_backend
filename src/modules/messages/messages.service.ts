import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  BadGatewayException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Message,
  MessageType,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
} from '@prisma/client';
import { MessageRepository } from '@common/messaging/repositories/message.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { ClientRepository } from '@common/messaging/repositories/client.repository';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { EvolutionService, EvolutionMediaType } from '@common/evolution/evolution.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendWithFileDto } from './dto/send-with-file.dto';
import { buildOutgoingMessageData } from '@common/utils/build-outgoing-message-data';
import { phoneFromJid, jidFromPhone } from '@common/utils/whatsapp-jid';
import { checkTenantOwnsConversation } from '@common/utils/check-tenant-owns-conversation';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly clientRepository: ClientRepository,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly fileStorageService: FileStorageService,
    private readonly evolutionService: EvolutionService,
  ) {}

  /**
   * Construye URLs completas para los mediaUrl de los mensajes
   */
  buildMessagesWithFullUrls(messages: Message[]): Message[] {
    const backendUrl = this.configService.get<string>('BACKEND_URL');

    return messages.map((message) => ({
      ...message,
      mediaUrl: message.mediaUrl
        ? message.mediaUrl.startsWith('http')
          ? message.mediaUrl
          : `${backendUrl}${message.mediaUrl}`
        : null,
    }));
  }

  /**
   * Valida que el contenido del mensaje sea válido según su tipo
   * @throws BadRequestException si el contenido no es válido
   */
  validateMessageContent(type: MessageType, content: string): void {
    // Para mensajes multimedia, el contenido puede estar vacío (solo caption)
    if (type === 'text') {
      if (!content || content.trim().length === 0) {
        throw new BadRequestException('Text message content cannot be empty');
      }

      if (content.length > 4096) {
        throw new BadRequestException(
          'Text message exceeds maximum length of 4096 characters',
        );
      }
    }

    // Para multimedia (image, video, audio, voice, document), el contenido es opcional (caption)
    if (content && content.length > 1024) {
      throw new BadRequestException(
        'Media caption exceeds maximum length of 1024 characters',
      );
    }
  }

  /**
   * Construye los datos de actualización de la conversación
   */
  buildConversationUpdate(message: Message) {
    return {
      lastMessageAt: message.createdAt,
      lastMessagePreview: message.content.substring(0, 100),
    };
  }

  resolveRemoteJid(
    conversation: { type: string; groupJid?: string | null; client?: { phoneNumber: string } | null },
    conversationId: string,
  ): string {
    const isGroup = conversation.type === 'group';
    const remoteJid = isGroup
      ? conversation.groupJid
      : conversation.client ? jidFromPhone(conversation.client.phoneNumber) : null;

    if (!remoteJid) {
      const detail = isGroup
        ? `group conversation ${conversationId} has no groupJid`
        : `individual conversation ${conversationId} has no client/participant`;
      throw new BadRequestException(`Cannot resolve recipient: ${detail}`);
    }

    return remoteJid;
  }

  private mapTypeToMediaType(tipo: MessageType): EvolutionMediaType {
    switch (tipo) {
      case MessageType.image: return EvolutionMediaType.IMAGE;
      case MessageType.video: return EvolutionMediaType.VIDEO;
      case MessageType.voice:
      case MessageType.audio: return EvolutionMediaType.AUDIO;
      case MessageType.document: return EvolutionMediaType.DOCUMENT;
      default: throw new BadRequestException(`Unsupported media type: ${tipo}`);
    }
  }

  /**
   * Valida que el tipo de mensaje coincida con el mimeType del archivo
   */
  private validateFileTypeMatchesMimeType(tipo: MessageType, mimeType: string): void {
    const validMappings: Record<MessageType, string[]> = {
      [MessageType.text]: [],
      [MessageType.voice]: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
      [MessageType.image]: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      [MessageType.video]: ['video/mp4', 'video/mpeg'],
      [MessageType.audio]: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
      [MessageType.document]: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    };

    const allowedMimes = validMappings[tipo] || [];
    if (!allowedMimes.includes(mimeType)) {
      throw new BadRequestException(
        `File type ${mimeType} is not valid for message type ${tipo}. Expected: ${allowedMimes.join(', ')}`,
      );
    }
  }

  /**
   * GET /api/messages — mensajes de una conversación, con fallback a Evolution
   * API cuando no hay historial en DB (bootstrapea en background).
   */
  async findAll(conversationId: string, tenantId: string) {
    this.logger.log(
      `findAll - tenantId: ${tenantId}, conversationId: ${conversationId}`,
    );

    if (!conversationId) {
      throw new BadRequestException('conversationId query parameter is required');
    }

    const conversation = await this.conversationRepository.findWithMessagesById(conversationId);

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    checkTenantOwnsConversation(conversation, conversation.phone, tenantId);

    const messages = conversation.messages;

    const isGroup = conversation.type === 'group';
    let remoteJid: string | null = null;
    if (messages.length === 0) {
      const clientId = conversation.client?.id;
      if (clientId) {
        const closedCount = await this.conversationRepository.countClosedSubConversations(
          conversation.phoneId,
          clientId,
        );
        if (closedCount > 0) {
          this.logger.log(`[messages] dbCount=0 but ${closedCount} closed sub-conversations exist — skipping Evolution fallback`);
        } else {
          remoteJid = this.resolveRemoteJid(conversation, conversationId);
        }
      } else {
        remoteJid = this.resolveRemoteJid(conversation, conversationId);
      }
    }
    this.logger.log(`[messages] dbCount=${messages.length} isGroup=${isGroup} remoteJid=${remoteJid ?? 'N/A'}`);

    if (messages.length === 0 && remoteJid) {
      return this.fetchFromEvolutionAndBootstrap(conversation, conversationId, remoteJid, isGroup, tenantId);
    }

    const messagesWithFullUrls = this.buildMessagesWithFullUrls(messages);
    this.logger.log(
      `Retrieved ${messages.length} messages for conversation ${conversationId}`,
    );
    return messagesWithFullUrls;
  }

  private async fetchFromEvolutionAndBootstrap(
    conversation: any,
    conversationId: string,
    remoteJid: string,
    isGroup: boolean,
    tenantId: string,
  ) {
    this.logger.log(`No messages in DB for conversation ${conversationId}, falling back to Evolution for remoteJid: ${remoteJid}`);
    const rawMessages = await this.evolutionService.findMessages(
      conversation.phone.evolutionInstanceId,
      remoteJid,
    );

    const instanceName = conversation.phone.evolutionInstanceId;
    let lidToClientMap = new Map<string, { phoneNumber: string; name: string | null; profilePicUrl: string | null }>();
    if (isGroup && rawMessages.length > 0) {
      lidToClientMap = await this.buildLidToClientMap(instanceName, remoteJid);
      this.logger.log(`[fallback] lidToClientMap: ${lidToClientMap.size} entries`);
    }

    this.bootstrapConversationInBackground(conversation, rawMessages, tenantId, isGroup ? lidToClientMap : undefined);

    return rawMessages
      .sort((a, b) => (a.messageTimestamp ?? 0) - (b.messageTimestamp ?? 0))
      .map((m) => {
        const { type, content, hasMedia } = this.evolutionService.parseMessageContent(m.message || {});
        const msgData = m.message || {};
        const quotedMessageId = this.extractQuotedMessageId(msgData, m.contextInfo);

        const metadata: Record<string, any> = { keyId: m.key?.id, mediaLoading: hasMedia };
        if (quotedMessageId) metadata.quotedMessageId = quotedMessageId;

        if (isGroup && !m.key?.fromMe && m.pushName) {
          this.applySenderInfo(metadata, lidToClientMap, m.pushName);
        }

        return {
          id: m.key?.id,
          conversationId,
          type,
          content,
          mediaUrl: null,
          fileName: null,
          fileSize: null,
          mimeType: null,
          direction: m.key?.fromMe ? MessageDirection.outgoing : MessageDirection.incoming,
          senderType: m.key?.fromMe ? MessageSenderType.agent : MessageSenderType.client,
          status: MessageStatus.delivered,
          metadata,
          createdAt: m.messageTimestamp ? new Date(m.messageTimestamp * 1000) : new Date(),
          updatedAt: new Date(),
        };
      });
  }

  private async buildLidToClientMap(instanceName: string, remoteJid: string) {
    const lidToClientMap = new Map<string, { phoneNumber: string; name: string | null; profilePicUrl: string | null }>();

    const participants = await this.evolutionService.fetchGroupParticipants(instanceName, remoteJid);
    const lidToPhone = new Map<string, string>();
    for (const p of participants) {
      if (p.phoneNumber) {
        const lid = p.id.replace('@lid', '');
        const phone = phoneFromJid(p.phoneNumber);
        lidToPhone.set(lid, phone);
      }
    }

    const phoneNumbers = [...new Set(lidToPhone.values())];
    if (phoneNumbers.length === 0) return lidToClientMap;

    const clients = await this.clientRepository.findManyByPhoneNumbers(phoneNumbers);
    const clientByPhone = new Map(clients.map((c) => [c.phoneNumber, c]));

    const phonesWithoutPic = phoneNumbers.filter((p) => !clientByPhone.get(p)?.profilePicUrl);
    for (const phone of phonesWithoutPic) {
      const picUrl = await this.evolutionService.fetchProfilePictureUrl(instanceName, jidFromPhone(phone));
      if (picUrl) {
        await this.clientRepository.updateProfilePicIfExists(phone, picUrl);
        const existing = clientByPhone.get(phone);
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

    return lidToClientMap;
  }

  private extractQuotedMessageId(msgData: any, rootContextInfo?: { stanzaId?: string }): string | undefined {
    for (const msgType of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
      const stanzaId = msgData[msgType]?.contextInfo?.stanzaId;
      if (stanzaId) return stanzaId;
    }
    return rootContextInfo?.stanzaId;
  }

  private applySenderInfo(
    metadata: Record<string, any>,
    lidToClientMap: Map<string, { phoneNumber: string; name: string | null; profilePicUrl: string | null }>,
    pushName: string,
  ): void {
    const clientInfo = lidToClientMap.get(pushName);
    if (clientInfo) {
      metadata.senderJid = jidFromPhone(clientInfo.phoneNumber);
      metadata.senderName = clientInfo.name || clientInfo.phoneNumber;
      if (clientInfo.profilePicUrl) metadata.senderProfilePicUrl = clientInfo.profilePicUrl;
    } else {
      metadata.senderName = pushName;
    }
  }

  private async bootstrapConversationInBackground(
    conversation: any,
    rawMessages: any[],
    tenantId: string,
    lidToClientMap?: Map<string, { phoneNumber: string; name: string | null; profilePicUrl: string | null }>,
  ) {
    try {
      const existingKeyIds = await this.messageRepository.findKeyIdsByConversationId(conversation.id);
      const newMessages = rawMessages
        .filter((m) => m.key?.id && !existingKeyIds.has(m.key.id))
        .sort((a, b) => (a.messageTimestamp ?? 0) - (b.messageTimestamp ?? 0));

      if (newMessages.length === 0) return;

      const ignoredTypes = ['reactionMessage', 'protocolMessage', 'pollUpdateMessage'];

      for (const m of newMessages) {
        const rawMsg = m.message || {};
        const ignoredType = ignoredTypes.find((t) => rawMsg[t]);
        if (ignoredType) continue;

        const { type, content, hasMedia } = this.evolutionService.parseMessageContent(rawMsg);
        let mediaData: { relativePath: string; fileName: string; fileSize: number; mimeType: string } | null = null;

        if (hasMedia && m.key?.id) {
          try {
            mediaData = await this.fileStorageService.downloadAndSaveMediaFromEvolution(
              this.evolutionService,
              conversation.phone.evolutionInstanceId,
              tenantId,
              conversation.id,
              m.key.id,
              m.key,
            );
            this.websocketGateway.emit(
              'message:media_ready',
              { keyId: m.key.id, conversationId: conversation.id, mediaUrl: mediaData.relativePath },
              tenantId,
            );
          } catch (err) {
            this.logger.warn(`Failed to download media for keyId ${m.key.id}: ${err.message}`);
          }
        }

        const msgData = m.message || {};
        const quotedMessageId = this.extractQuotedMessageId(msgData, m.contextInfo);

        const meta: Record<string, any> = {};
        if (m.key?.id) meta.keyId = m.key.id;
        if (quotedMessageId) meta.quotedMessageId = quotedMessageId;

        if (lidToClientMap && !m.key?.fromMe && m.pushName) {
          this.applySenderInfo(meta, lidToClientMap, m.pushName);
        }

        await this.messageRepository.create({
          conversationId: conversation.id,
          type,
          content,
          mediaUrl: mediaData?.relativePath || null,
          fileName: mediaData?.fileName || null,
          fileSize: mediaData?.fileSize || null,
          mimeType: mediaData?.mimeType || null,
          direction: m.key?.fromMe ? MessageDirection.outgoing : MessageDirection.incoming,
          senderType: m.key?.fromMe ? MessageSenderType.agent : MessageSenderType.client,
          status: MessageStatus.delivered,
          metadata: Object.keys(meta).length > 0 ? meta : null,
          createdAt: m.messageTimestamp ? new Date(m.messageTimestamp * 1000) : undefined,
        });
      }

      this.logger.log(`Background: bootstrapped ${newMessages.length} messages for conversation ${conversation.id}`);
    } catch (err) {
      this.logger.error(`Background bootstrap failed for conversation ${conversation.id}: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * POST /api/messages/send
   */
  async send(dto: CreateMessageDto, tenantId: string) {
    this.logger.log(
      `send - tenantId: ${tenantId}, conversationId: ${dto.conversationId}`,
    );

    this.validateMessageContent(dto.tipo, dto.contenido);

    const conversation = await this.conversationRepository.findByIdWithRelations(
      dto.conversationId,
    );

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${dto.conversationId} not found`,
      );
    }

    checkTenantOwnsConversation(conversation, conversation.phone, tenantId);

    if (conversation.mode !== 'HITL') {
      throw new ForbiddenException('Cannot send message: conversation is in AI mode. Take control first.');
    }

    const remoteJid = this.resolveRemoteJid(conversation, dto.conversationId);

    const relativePath = dto.mediaUrl || null;
    const mediaUrlForEvolution = relativePath
      ? this.fileStorageService.buildDockerAccessibleUrl(relativePath)
      : null;

    const quotedKey = await this.resolveQuotedKey(dto.quotedMessageId, dto.conversationId, remoteJid);

    try {
      let evolutionKeyId: string;
      if (dto.tipo === MessageType.text) {
        const response = await this.evolutionService.sendTextMessage(
          conversation.phone.evolutionInstanceId,
          remoteJid,
          dto.contenido,
          quotedKey,
        );
        evolutionKeyId = response.key.id;
      } else if (mediaUrlForEvolution) {
        const mediatype = this.mapTypeToMediaType(dto.tipo);
        const response = await this.evolutionService.sendMediaMessage(
          conversation.phone.evolutionInstanceId,
          remoteJid,
          mediaUrlForEvolution,
          mediatype,
          dto.contenido || undefined,
        );
        evolutionKeyId = response.key.id;
      } else {
        throw new BadRequestException('mediaUrl is required for multimedia messages');
      }

      const messageData = buildOutgoingMessageData(
        dto.conversationId,
        dto.tipo,
        dto.contenido,
        'pending',
        relativePath,
        evolutionKeyId,
        undefined,
        undefined,
        undefined,
        'agent',
        dto.quotedMessageId,
      );
      const { message } = await this.messageRepository.sendMessageTransaction(
        dto.conversationId,
        tenantId,
        messageData,
        { lastMessageAt: new Date(), lastMessagePreview: dto.contenido.substring(0, 100) },
      );
      const [messageWithUrl] = this.buildMessagesWithFullUrls([message]);
      return messageWithUrl;
    } catch (error) {
      this.websocketGateway.emit(
        'message:error',
        { conversationId: dto.conversationId, error: 'Failed to send message via WhatsApp' },
        tenantId,
      );
      throw error;
    }
  }

  private async resolveQuotedKey(
    quotedMessageId: string | undefined,
    conversationId: string,
    remoteJid: string,
  ): Promise<{ id: string; remoteJid: string; fromMe: boolean } | undefined> {
    if (!quotedMessageId) return undefined;

    const quotedMessage = await this.messageRepository.findById(quotedMessageId);
    if (!quotedMessage || quotedMessage.conversationId !== conversationId) {
      throw new NotFoundException(`Quoted message with id ${quotedMessageId} not found`);
    }
    const keyId = (quotedMessage.metadata as any)?.keyId;
    if (!keyId) {
      throw new NotFoundException(`Quoted message ${quotedMessageId} has no Evolution keyId`);
    }
    return {
      id: keyId,
      remoteJid,
      fromMe: quotedMessage.direction === 'outgoing',
    };
  }

  /**
   * POST /api/messages/send-with-file
   */
  async sendWithFile(file: Express.Multer.File, dto: SendWithFileDto, tenantId: string) {
    this.logger.log(
      `sendWithFile - tenantId: ${tenantId}, conversationId: ${dto.conversationId}`,
    );

    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (dto.tipo === MessageType.text || dto.tipo === MessageType.voice) {
      throw new BadRequestException(
        'File upload is only for image, video, audio, and document types',
      );
    }

    this.validateFileTypeMatchesMimeType(dto.tipo, file.mimetype);

    const conversation = await this.conversationRepository.findByIdWithRelations(
      dto.conversationId,
    );

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${dto.conversationId} not found`,
      );
    }

    checkTenantOwnsConversation(conversation, conversation.phone, tenantId);

    if (conversation.mode !== 'HITL') {
      throw new ForbiddenException('Cannot send message: conversation is in AI mode. Take control first.');
    }

    const remoteJid = this.resolveRemoteJid(conversation, dto.conversationId);

    const { randomUUID } = await import('crypto');
    const messageId = randomUUID();

    this.logger.log(`Generated messageId: ${messageId} for file upload`);
    this.logger.log(`Saving file: ${file.mimetype}, size: ${file.size} bytes`);

    let relativePath: string;
    let fileName: string;
    let finalMimeType: string;

    try {
      const result = await this.fileStorageService.saveUploadedFile(
        file,
        tenantId,
        dto.conversationId,
        messageId,
      );
      relativePath = result.relativePath;
      fileName = result.fileName;
      finalMimeType = result.mimeType;

      this.logger.log(`File saved successfully: ${relativePath}`);
    } catch (error) {
      this.logger.error(`Failed to save file: ${error.message}`, error.stack);
      throw new BadGatewayException(`Failed to save file: ${error.message}`);
    }

    const mediaUrl = this.fileStorageService.buildDockerAccessibleUrl(relativePath);

    this.logger.log(`About to send - tipo: ${dto.tipo}, mimeType: ${finalMimeType}, fileName: ${fileName}, mediaUrl: ${mediaUrl}`);

    try {
      const mediatype = this.mapTypeToMediaType(dto.tipo);
      const response = await this.evolutionService.sendMediaMessage(
        conversation.phone.evolutionInstanceId,
        remoteJid,
        mediaUrl,
        mediatype,
        dto.contenido || undefined,
        finalMimeType,
        fileName,
      );
      const evolutionKeyId = response.key.id;

      const messageData = buildOutgoingMessageData(
        dto.conversationId,
        dto.tipo,
        dto.contenido || '',
        'pending',
        relativePath,
        evolutionKeyId,
        fileName,
        file.size,
        finalMimeType,
      );
      const { message } = await this.messageRepository.sendMessageTransaction(
        dto.conversationId,
        tenantId,
        messageData,
        { lastMessageAt: new Date(), lastMessagePreview: (dto.contenido || fileName).substring(0, 100) },
        messageId,
      );
      const [messageWithUrl] = this.buildMessagesWithFullUrls([message]);
      return messageWithUrl;
    } catch (error) {
      this.websocketGateway.emit(
        'message:error',
        { conversationId: dto.conversationId, error: 'Failed to send message via WhatsApp' },
        tenantId,
      );
      throw error;
    }
  }
}
