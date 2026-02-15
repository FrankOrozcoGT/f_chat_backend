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
import { MessagesService } from './messages.service';
import { MessageSendService } from './message-send.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendWithFileDto } from './dto/send-with-file.dto';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { MessageType } from '@prisma/client';

@Controller('api/messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly phoneRepository: PhoneRepository,
    private readonly messagesService: MessagesService,
    private readonly messageSendService: MessageSendService,
    private readonly websocketGateway: AppWebSocketGateway,
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

    // Validar que la conversación esté en modo HITL
    if (conversation.mode !== 'HITL') {
      throw new ForbiddenException('Cannot send message: conversation is in AI mode. Take control first.');
    }

    // 3. Si hay mediaUrl, construir URL completa para Evolution
    const relativePath = dto.mediaUrl || null;
    const mediaUrlForEvolution = relativePath
      ? this.fileStorageService.buildDockerAccessibleUrl(relativePath)
      : null;

    // 4. Enviar usando flujo centralizado
    try {
      return await this.messageSendService.send({
        conversationId: dto.conversationId,
        userId,
        instanceId: conversation.phone.evolutionInstanceId,
        clientPhone: conversation.client.phoneNumber,
        tipo: dto.tipo,
        contenido: dto.contenido,
        relativePath,
        mediaUrlForEvolution,
      });
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

    // 8. Enviar usando flujo centralizado
    try {
      return await this.messageSendService.send({
        conversationId: dto.conversationId,
        userId,
        instanceId: conversation.phone.evolutionInstanceId,
        clientPhone: conversation.client.phoneNumber,
        tipo: dto.tipo,
        contenido: dto.contenido || '',
        relativePath,
        mediaUrlForEvolution: mediaUrl,
        messageId,
        mimeType: finalMimeType,
        fileName,
      });
    } catch (error) {
      this.websocketGateway.emit(
        'message:error',
        { conversationId: dto.conversationId, error: 'Failed to send message via WhatsApp' },
        userId,
      );
      throw error;
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
