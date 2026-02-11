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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendWithFileDto } from './dto/send-with-file.dto';
import { EvolutionService, EvolutionMediaType } from '@common/evolution/evolution.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { CacheService } from '@common/cache/cache.service';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { MessageType, Conversation, Phone, Client } from '@prisma/client';

type ConversationWithRelations = Conversation & {
  phone: Phone;
  client: Client;
};

@Controller('api/messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly phoneRepository: PhoneRepository,
    private readonly messagesService: MessagesService,
    private readonly evolutionService: EvolutionService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly cacheService: CacheService,
    private readonly fileStorageService: FileStorageService,
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

    // 2. Obtener conversación por ID
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    // 3. Obtener phone asociado
    const phone = await this.phoneRepository.findById(conversation.phoneId);
    if (!phone) {
      throw new NotFoundException(
        `Phone associated with conversation not found`,
      );
    }

    // 4. Validar permisos (Service - lógica pura)
    this.messagesService.checkUserOwnsConversation(conversation, phone, userId);

    // 5. Obtener mensajes
    const messages = await this.messageRepository.findByConversationId(
      conversationId,
    );

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

    // 3. Si hay mediaUrl, construir URL completa para Evolution
    const relativePath = dto.mediaUrl || null;
    const mediaUrlForEvolution = relativePath
      ? this.fileStorageService.buildDockerAccessibleUrl(relativePath)
      : null;

    // 4. Ejecutar envío común (Evolution API + DB + Cache)
    return this.executeMessageSend(
      dto.conversationId,
      userId,
      dto.tipo,
      dto.contenido,
      relativePath,
      mediaUrlForEvolution,
      conversation,
    );
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

    // 3. Obtener conversación con relaciones y validar permisos
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

    // 4. Guardar archivo usando FileStorageService
    this.logger.log(`Saving file: ${file.mimetype}, size: ${file.size} bytes`);

    let relativePath: string;
    let fileName: string;
    let finalMimeType: string;

    try {
      const result = await this.fileStorageService.saveUploadedFile(
        file,
        userId,
        dto.conversationId,
      );
      relativePath = result.relativePath;
      fileName = result.fileName;
      finalMimeType = result.mimeType;

      this.logger.log(`File saved successfully: ${relativePath}`);
    } catch (error) {
      this.logger.error(`Failed to save file: ${error.message}`, error.stack);
      throw new BadGatewayException(`Failed to save file: ${error.message}`);
    }

    // 5. Construir mediaUrl accesible desde Evolution API (Docker)
    const mediaUrl = this.fileStorageService.buildDockerAccessibleUrl(relativePath);

    this.logger.log(`About to send - tipo: ${dto.tipo}, mimeType: ${finalMimeType}, fileName: ${fileName}, mediaUrl: ${mediaUrl}`);

    // 6. Ejecutar envío común (Evolution API + DB + Cache)
    return this.executeMessageSend(
      dto.conversationId,
      userId,
      dto.tipo,
      dto.contenido || '',
      relativePath,
      mediaUrl,
      conversation,
      finalMimeType,
      fileName,
    );
  }

  /**
   * Método privado que centraliza la lógica de envío de mensajes
   * Usado tanto por POST /send como POST /send-with-file
   */
  private async executeMessageSend(
    conversationId: string,
    userId: string,
    tipo: MessageType,
    contenido: string,
    relativePath: string | null,
    mediaUrlForEvolution: string | null,
    conversation: ConversationWithRelations,
    mimeType?: string,
    fileName?: string,
  ) {
    const { phone, client } = conversation;

    // 1. Enviar vía Evolution API PRIMERO
    let evolutionKeyId: string;
    try {
      let response: { key: { id: string } };
      if (tipo === MessageType.text) {
        response = await this.evolutionService.sendTextMessage(
          phone.evolutionInstanceId,
          client.phoneNumber,
          contenido,
        );
      } else if (mediaUrlForEvolution) {
        // Mapear MessageType a EvolutionMediaType
        const mediatype = this.mapMessageTypeToMediaType(tipo);

        response = await this.evolutionService.sendMediaMessage(
          phone.evolutionInstanceId,
          client.phoneNumber,
          mediaUrlForEvolution,
          mediatype,
          contenido || undefined,
          mimeType,
          fileName,
        );
      } else {
        throw new BadRequestException(
          'mediaUrl is required for multimedia messages',
        );
      }

      // Capturar keyId
      evolutionKeyId = response.key.id;

      this.logger.log(
        `Evolution API accepted message for ${client.phoneNumber}, keyId: ${evolutionKeyId}`,
      );
    } catch (error) {
      this.logger.error(`Evolution API rejected message: ${error.message}`);

      // Emitir evento WebSocket de error
      this.websocketGateway.emit(
        'message:error',
        {
          conversationId,
          error: 'Failed to send message via WhatsApp',
        },
        userId,
      );

      throw new BadGatewayException('Failed to send message via WhatsApp');
    }

    // 2. Guardar keyId en cache ANTES de DB (para evitar duplicación en webhook)
    this.cacheService.set(
      `sent_message:${evolutionKeyId}`,
      { userId, conversationId },
      300, // 5 minutos TTL
    );

    this.logger.log(`Cache SET: sent_message:${evolutionKeyId}`);

    // 3. Build messageData con metadata.keyId (usar relativePath para DB)
    const messageData = this.messagesService.buildOutgoingMessageData(
      conversationId,
      tipo,
      contenido,
      'pending', // Webhook actualizará a sent/delivered/read
      relativePath,
      evolutionKeyId,
    );

    // 4. Guardar en DB
    const conversationUpdate = {
      lastMessageAt: new Date(),
      lastMessagePreview: contenido.substring(0, 100),
    };

    try {
      const { message } = await this.messageRepository.sendMessageTransaction(
        conversationId,
        userId,
        messageData,
        conversationUpdate,
      );

      this.logger.log(
        `Message saved with status 'pending', webhook will update status`,
      );

      return message;
    } catch (error) {
      this.logger.error(`Failed to save message in DB: ${error.message}`);
      throw new BadGatewayException('Message sent but failed to save in database');
    }
  }

  /**
   * Mapea MessageType a EvolutionMediaType
   */
  private mapMessageTypeToMediaType(tipo: MessageType): EvolutionMediaType {
    switch (tipo) {
      case MessageType.image:
        return EvolutionMediaType.IMAGE;
      case MessageType.video:
        return EvolutionMediaType.VIDEO;
      case MessageType.voice:
      case MessageType.audio:
        return EvolutionMediaType.AUDIO;
      case MessageType.document:
        return EvolutionMediaType.DOCUMENT;
      default:
        throw new BadRequestException(`Unsupported media type: ${tipo}`);
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
