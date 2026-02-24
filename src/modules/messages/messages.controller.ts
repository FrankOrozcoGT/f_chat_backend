import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  Logger,
  BadRequestException,
  NotFoundException,
  BadGatewayException,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { ClientRepository } from '@modules/webhooks/repositories/client.repository';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendWithFileDto } from './dto/send-with-file.dto';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { EvolutionService, EvolutionMediaType } from '@common/evolution/evolution.service';
import { MessageType, MessageDirection, MessageSenderType, MessageStatus } from '@prisma/client';

@Controller('api/messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly phoneRepository: PhoneRepository,
    private readonly clientRepository: ClientRepository,
    private readonly messagesService: MessagesService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly fileStorageService: FileStorageService,
    private readonly evolutionService: EvolutionService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Query('conversationId') conversationId: string, @Req() req) {
    const userId = req.user.id;

    this.logger.log(
      `GET /api/messages - userId: ${userId}, conversationId: ${conversationId}`,
    );

    // 1. Validar que conversationId existe
    if (!conversationId) {
      throw new BadRequestException('conversationId query parameter is required');
    }

    // 2. Obtener conversación con relaciones (phone + client en 1 query)
    const conversation = await this.conversationRepository.findByIdWithRelations(conversationId);

    // Fallback: si no existe en DB y es un remoteJid, buscar en Evolution
    if (!conversation) {
      if (!conversationId.endsWith('@s.whatsapp.net')) {
        throw new NotFoundException(`Conversation with id ${conversationId} not found`);
      }

      const phones = await this.phoneRepository.findAllByUserId(userId);
      const phone = phones[0] ?? null;
      if (!phone) {
        throw new NotFoundException(`No phone found for user`);
      }

      this.logger.log(`Conversation not in DB, falling back to Evolution for remoteJid: ${conversationId}`);
      const rawMessages = await this.evolutionService.findMessages(phone.instanceName, conversationId);

      const phoneNumber = conversationId.replace('@s.whatsapp.net', '');
      const firstWithName = rawMessages.find((m) => m.pushName && !m.key?.fromMe);
      this.bootstrapConversationInBackground(phone, phoneNumber, firstWithName?.pushName || phoneNumber, rawMessages, userId);

      return rawMessages.map((m) => {
        const { type, content, hasMedia } = this.evolutionService.parseMessageContent(m.message || {});
        return {
          id: m.key?.id || m.id,
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
          metadata: { keyId: m.key?.id, mediaLoading: hasMedia },
          createdAt: m.messageTimestamp ? new Date(m.messageTimestamp * 1000) : new Date(),
          updatedAt: new Date(),
        };
      });
    }

    // 3. Validar permisos
    this.messagesService.checkUserOwnsConversation(conversation, conversation.phone, userId);

    // 4. Obtener mensajes
    const messages = await this.messageRepository.findByConversationId(conversationId);

    // Fallback: si no hay mensajes en DB, consultar Evolution
    if (messages.length === 0 && conversation.client) {
      const remoteJid = `${conversation.client.phoneNumber}@s.whatsapp.net`;
      this.logger.log(`No messages in DB for conversation ${conversationId}, falling back to Evolution for remoteJid: ${remoteJid}`);
      const rawMessages = await this.evolutionService.findMessages(conversation.phone.instanceName, remoteJid);

      this.bootstrapConversationInBackground(conversation.phone, conversation.client.phoneNumber, conversation.client.name || conversation.client.phoneNumber, rawMessages, userId);

      return rawMessages
        .sort((a, b) => (b.messageTimestamp ?? 0) - (a.messageTimestamp ?? 0))
        .map((m) => {
          const { type, content, hasMedia } = this.evolutionService.parseMessageContent(m.message || {});
          return {
            id: m.key?.id || m.id,
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
            metadata: { keyId: m.key?.id, mediaLoading: hasMedia },
            createdAt: m.messageTimestamp ? new Date(m.messageTimestamp * 1000) : new Date(),
            updatedAt: new Date(),
          };
        });
    }

    // 6. Construir URLs completas para mediaUrl
    const messagesWithFullUrls = this.messagesService.buildMessagesWithFullUrls(messages);

    this.logger.log(
      `Retrieved ${messages.length} messages for conversation ${conversationId}`,
    );

    return messagesWithFullUrls;
  }

  @Post('send')
  @UseGuards(JwtAuthGuard)
  async send(@Body() dto: CreateMessageDto, @Req() req) {
    const userId = req.user.id;

    this.logger.log(
      `POST /api/messages/send - userId: ${userId}, conversationId: ${dto.conversationId}`,
    );

    // 1. Validar contenido del mensaje
    this.messagesService.validateMessageContent(dto.tipo, dto.contenido);

    // 2. Obtener conversación con relaciones y validar permisos (1 query)
    const conversation = await this.conversationRepository.findByIdWithRelations(
      dto.conversationId,
    );

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${dto.conversationId} not found`,
      );
    }

    // Validar permisos
    this.messagesService.checkUserOwnsConversation(conversation, conversation.phone, userId);

    // Validar que la conversación esté en modo HITL
    if (conversation.mode !== 'HITL') {
      throw new ForbiddenException('Cannot send message: conversation is in AI mode. Take control first.');
    }

    // 3. Si hay mediaUrl, construir URL completa para Evolution
    const relativePath = dto.mediaUrl || null;
    const mediaUrlForEvolution = relativePath
      ? this.fileStorageService.buildDockerAccessibleUrl(relativePath)
      : null;

    // 4. Si viene quotedMessageId, buscar el mensaje citado por su id de DB
    let quotedKey: { id: string; remoteJid: string; fromMe: boolean } | undefined;
    if (dto.quotedMessageId) {
      const quotedMessage = await this.messageRepository.findById(dto.quotedMessageId);
      if (!quotedMessage) {
        throw new NotFoundException(`Quoted message with id ${dto.quotedMessageId} not found`);
      }
      const keyId = (quotedMessage.metadata as any)?.keyId;
      if (!keyId) {
        throw new NotFoundException(`Quoted message ${dto.quotedMessageId} has no Evolution keyId`);
      }
      quotedKey = {
        id: keyId,
        remoteJid: `${conversation.client.phoneNumber}@s.whatsapp.net`,
        fromMe: quotedMessage.direction === 'outgoing',
      };
    }

    // 5. Enviar vía Evolution API + guardar en BD
    try {
      let evolutionKeyId: string;
      if (dto.tipo === MessageType.text) {
        const response = await this.evolutionService.sendTextMessage(
          conversation.phone.evolutionInstanceId,
          conversation.client.phoneNumber,
          dto.contenido,
          quotedKey,
        );
        evolutionKeyId = response.key.id;
      } else if (mediaUrlForEvolution) {
        const mediatype = this.mapTypeToMediaType(dto.tipo);
        const response = await this.evolutionService.sendMediaMessage(
          conversation.phone.evolutionInstanceId,
          conversation.client.phoneNumber,
          mediaUrlForEvolution,
          mediatype,
          dto.contenido || undefined,
        );
        evolutionKeyId = response.key.id;
      } else {
        throw new BadRequestException('mediaUrl is required for multimedia messages');
      }

      const messageData = this.messagesService.buildOutgoingMessageData(
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
        userId,
        messageData,
        { lastMessageAt: new Date(), lastMessagePreview: dto.contenido.substring(0, 100) },
      );
      const [messageWithUrl] = this.messagesService.buildMessagesWithFullUrls([message]);
      return messageWithUrl;
    } catch (error) {
      this.websocketGateway.emit(
        'message:error',
        { conversationId: dto.conversationId, error: 'Failed to send message via WhatsApp' },
        userId,
      );
      throw error;
    }
  }

  @Post('send-with-file')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 16 * 1024 * 1024, // 16MB max
      },
      fileFilter: (req, file, cb) => {
        const logger = new Logger('FileFilter');
        logger.log(`[FILE UPLOAD] mimetype: ${file.mimetype}, originalname: ${file.originalname}`);

        const allowedMimes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'video/mp4',
          'video/mpeg',
          'audio/mpeg',
          'audio/ogg',
          'audio/wav',
          'audio/webm',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];

        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          logger.error(`[FILE REJECTED] mimetype: ${file.mimetype} not in allowed list`);
          cb(new BadRequestException('File type not allowed'), false);
        }
      },
    }),
  )
  async sendWithFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendWithFileDto,
    @Req() req,
  ) {
    const userId = req.user.id;

    this.logger.log(
      `POST /api/messages/send-with-file - userId: ${userId}, conversationId: ${dto.conversationId}`,
    );

    // 1. Validar que file exista
    if (!file) {
      throw new BadRequestException('File is required');
    }

    // 2. Validar que tipo no sea text ni voice (esos no llevan archivo)
    if (dto.tipo === MessageType.text || dto.tipo === MessageType.voice) {
      throw new BadRequestException(
        'File upload is only for image, video, audio, and document types',
      );
    }

    // 3. Validar que tipo coincida con mimeType del archivo
    this.validateFileTypeMatchesMimeType(dto.tipo, file.mimetype);

    // 4. Obtener conversación con relaciones y validar permisos
    const conversation = await this.conversationRepository.findByIdWithRelations(
      dto.conversationId,
    );

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${dto.conversationId} not found`,
      );
    }

    // Validar permisos
    this.messagesService.checkUserOwnsConversation(conversation, conversation.phone, userId);

    // Validar que la conversación esté en modo HITL
    if (conversation.mode !== 'HITL') {
      throw new ForbiddenException('Cannot send message: conversation is in AI mode. Take control first.');
    }

    // 5. Generar messageId único ANTES de guardar el archivo (para nombre estandarizado)
    const { randomUUID } = await import('crypto');
    const messageId = randomUUID();

    this.logger.log(`Generated messageId: ${messageId} for file upload`);

    // 6. Guardar archivo usando FileStorageService con messageId
    this.logger.log(`Saving file: ${file.mimetype}, size: ${file.size} bytes`);

    let relativePath: string;
    let fileName: string;
    let finalMimeType: string;

    try {
      const result = await this.fileStorageService.saveUploadedFile(
        file,
        userId,
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

    // 7. Construir mediaUrl accesible desde Evolution API (Docker)
    const mediaUrl = this.fileStorageService.buildDockerAccessibleUrl(relativePath);

    this.logger.log(`About to send - tipo: ${dto.tipo}, mimeType: ${finalMimeType}, fileName: ${fileName}, mediaUrl: ${mediaUrl}`);

    // 8. Enviar vía Evolution API + guardar en BD
    try {
      const mediatype = this.mapTypeToMediaType(dto.tipo);
      const response = await this.evolutionService.sendMediaMessage(
        conversation.phone.evolutionInstanceId,
        conversation.client.phoneNumber,
        mediaUrl,
        mediatype,
        dto.contenido || undefined,
        finalMimeType,
        fileName,
      );
      const evolutionKeyId = response.key.id;

      const messageData = this.messagesService.buildOutgoingMessageData(
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
        userId,
        messageData,
        { lastMessageAt: new Date(), lastMessagePreview: (dto.contenido || fileName).substring(0, 100) },
        messageId,
      );
      const [messageWithUrl] = this.messagesService.buildMessagesWithFullUrls([message]);
      return messageWithUrl;
    } catch (error) {
      this.websocketGateway.emit(
        'message:error',
        { conversationId: dto.conversationId, error: 'Failed to send message via WhatsApp' },
        userId,
      );
      throw error;
    }
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

  private async bootstrapConversationInBackground(
    phone: any,
    phoneNumber: string,
    clientName: string,
    rawMessages: any[],
    userId: string,
  ) {
    try {
      // 1. Upsert client
      const client = await this.clientRepository.upsert({ phoneNumber, name: clientName });

      // 2. Upsert conversation
      const conversation = await this.conversationRepository.upsert({
        phoneId: phone.id,
        clientId: client.id,
        isActive: true,
      });

      // 3. Deduplicar mensajes ya persistidos
      const existingKeyIds = await this.messageRepository.findKeyIdsByConversationId(conversation.id);
      const newMessages = rawMessages
        .filter((m) => m.key?.id && !existingKeyIds.has(m.key.id))
        .sort((a, b) => (b.messageTimestamp ?? 0) - (a.messageTimestamp ?? 0));

      if (newMessages.length === 0) return;

      // 4. Persistir mensajes, descargando media cuando aplica
      for (const m of newMessages) {
        const { type, content, hasMedia } = this.evolutionService.parseMessageContent(m.message || {});
        let mediaData: { relativePath: string; fileName: string; fileSize: number; mimeType: string } | null = null;

        if (hasMedia && m.key?.id) {
          try {
            mediaData = await this.fileStorageService.downloadAndSaveMediaFromEvolution(
              this.evolutionService,
              phone.instanceName,
              userId,
              conversation.id,
              m.key.id,
              m.key,
            );
            // Notificar al frontend que el media ya está listo
            this.websocketGateway.emit(
              'message:media_ready',
              { id: m.key.id, conversationId: conversation.id, mediaUrl: mediaData.relativePath },
              userId,
            );
          } catch (err) {
            this.logger.warn(`Failed to download media for keyId ${m.key.id}: ${err.message}`);
          }
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
          metadata: { keyId: m.key?.id },
          createdAt: m.messageTimestamp ? new Date(m.messageTimestamp * 1000) : undefined,
        });
      }

      this.logger.log(`Background: bootstrapped conversation ${conversation.id} with ${newMessages.length} messages`);
    } catch (err) {
      this.logger.error(`Background bootstrap failed: ${err.message}`);
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
}
