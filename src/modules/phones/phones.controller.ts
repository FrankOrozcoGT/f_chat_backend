import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  Req,
  Logger,
  BadGatewayException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { EvolutionService } from '@common/evolution/evolution.service';
import { LimitsService } from '@common/services/limits.service';
import { PhoneRepository } from './repositories/phone.repository';
import { PhonesService } from './phones.service';
import { PhoneResponseDto } from './dto/phone-response.dto';
import { CreatePhoneDto } from './dto/create-phone.dto';
import { ContactResponseDto } from './dto/contact-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { ClientRepository } from '@modules/webhooks/repositories/client.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { MessageRepository } from '@modules/webhooks/repositories/message.repository';
import { MessageType, MessageDirection, MessageSenderType, MessageStatus } from '@prisma/client';

@Controller('api/phones')
@UseInterceptors(ClassSerializerInterceptor)
export class PhonesController {
  private readonly logger = new Logger(PhonesController.name);

  constructor(
    private readonly phoneRepository: PhoneRepository,
    private readonly phonesService: PhonesService,
    private readonly evolutionService: EvolutionService,
    private readonly limitsService: LimitsService,
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Req() req): Promise<PhoneResponseDto[]> {
    const userId = req.user.id;
    const phones = await this.phoneRepository.findAllByUserId(userId);
    return phones.map((phone) => new PhoneResponseDto(phone));
  }

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreatePhoneDto, @Req() req) {
    const userId = req.user.id;

    // 1. Validar instanceName
    this.phonesService.validateInstanceName(dto.instanceName);

    // 2. Validar límite de WhatsApp
    await this.limitsService.validateWhatsAppLimit(userId);

    // 3. Crear instancia en Evolution API con QR (webhook se configura global en docker-compose)
    let evolutionData;
    try {
      evolutionData = await this.evolutionService.createInstance(
        dto.instanceName,
        { qrcode: true },
      );
    } catch (error) {
      this.logger.error(`Failed to create instance in Evolution API: ${error.message}`);
      throw new BadGatewayException('Failed to create WhatsApp instance');
    }

    // 4. Construir datos del phone con QR
    const phoneData = this.phonesService.buildPhoneData(dto, evolutionData, userId);

    // 5. Guardar en DB
    const phone = await this.phoneRepository.create(phoneData);

    this.logger.log(`Phone instance created successfully: ${phone.id}`);

    // 6. Retornar phone + qrCode
    return {
      phone: new PhoneResponseDto(phone),
      qrCode: evolutionData.qrcode?.code || null,
    };
  }

  @Get(':id/contacts')
  @UseGuards(JwtAuthGuard)
  async findContacts(@Param('id') phoneId: string, @Req() req): Promise<ContactResponseDto[]> {
    const userId = req.user.id;

    // 1. Buscar phone y verificar ownership
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      throw new NotFoundException('Phone not found');
    }

    if (phone.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // 2. Obtener contactos de Evolution API
    let rawContacts: any[];
    try {
      rawContacts = await this.evolutionService.findContacts(phone.instanceName);
    } catch (error) {
      this.logger.error(`Failed to get contacts for phone ${phoneId}: ${error.message}`);
      throw new BadGatewayException('Failed to retrieve contacts from WhatsApp');
    }

    // 3. Mapear todos los contactos
    const contacts = rawContacts.map((c) => new ContactResponseDto({
      id: c.remoteJid,
      name: c.pushName || c.remoteJid.split('@')[0],
      phoneNumber: c.remoteJid.split('@')[0],
    }));

    return contacts;
  }

  @Get(':id/messages/:remoteJid')
  @UseGuards(JwtAuthGuard)
  async findMessages(
    @Param('id') phoneId: string,
    @Param('remoteJid') remoteJid: string,
    @Req() req,
  ): Promise<MessageResponseDto[]> {
    const userId = req.user.id;

    // 1. Buscar phone y verificar ownership
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      throw new NotFoundException('Phone not found');
    }
    if (phone.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // 2. Obtener mensajes de Evolution API
    let rawMessages: any[];
    try {
      rawMessages = await this.evolutionService.findMessages(phone.instanceName, remoteJid);
    } catch (error) {
      this.logger.error(`Failed to get messages for phone ${phoneId}: ${error.message}`);
      throw new BadGatewayException('Failed to retrieve messages from WhatsApp');
    }

    if (rawMessages.length === 0) {
      return [];
    }

    // Log de distribución de mensajes
    const fromMeCount = rawMessages.filter((m) => m.key?.fromMe).length;
    this.logger.log(`Messages: total=${rawMessages.length} fromMe=${fromMeCount} fromClient=${rawMessages.length - fromMeCount}`);
    rawMessages.forEach((m, i) => {
      this.logger.log(`[${i}] fromMe=${m.key?.fromMe} type=${m.messageType} ts=${m.messageTimestamp}`);
    });

    // 3. Upsert Client por remoteJid
    const phoneNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    const firstWithName = rawMessages.find((m) => m.pushName && !m.key?.fromMe);
    const client = await this.clientRepository.upsert({
      phoneNumber,
      name: firstWithName?.pushName || phoneNumber,
    });

    // 4. Upsert Conversation
    const conversation = await this.conversationRepository.upsert({
      phoneId,
      clientId: client.id,
      isActive: true,
    });

    // 5. Obtener keyIds existentes en DB para esta conversación
    const existingKeyIds = await this.messageRepository.findKeyIdsByConversationId(conversation.id);

    // 6. Filtrar mensajes nuevos y persistir
    const newMessages = rawMessages.filter((m) => m.key?.id && !existingKeyIds.has(m.key.id));

    if (newMessages.length > 0) {
      const messageData = newMessages.map((m) => {
        const messageContent = m.message || {};
        let type: MessageType = MessageType.text;
        let content = '';

        if (messageContent.conversation) {
          type = MessageType.text;
          content = messageContent.conversation;
        } else if (messageContent.extendedTextMessage) {
          type = MessageType.text;
          content = messageContent.extendedTextMessage.text || '';
        } else if (messageContent.imageMessage) {
          type = MessageType.image;
          content = messageContent.imageMessage.caption || '';
        } else if (messageContent.videoMessage) {
          type = MessageType.video;
          content = messageContent.videoMessage.caption || '';
        } else if (messageContent.audioMessage) {
          type = MessageType.voice;
          content = '';
        } else if (messageContent.documentMessage) {
          type = MessageType.document;
          content = messageContent.documentMessage.caption || messageContent.documentMessage.fileName || '';
        }

        return {
          conversationId: conversation.id,
          type,
          content,
          mediaUrl: null,
          direction: m.key?.fromMe ? MessageDirection.outgoing : MessageDirection.incoming,
          senderType: m.key?.fromMe ? MessageSenderType.agent : MessageSenderType.client,
          status: MessageStatus.delivered,
          metadata: { keyId: m.key?.id },
        };
      });

      await this.messageRepository.createMany(messageData);
    }

    return rawMessages;
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') phoneId: string, @Req() req) {
    const userId = req.user.id;

    // 1. Buscar phone y verificar ownership
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      throw new NotFoundException('Phone not found');
    }

    if (phone.userId !== userId) {
      throw new NotFoundException('Phone not found');
    }

    // 2. Eliminar instancia en Evolution API
    try {
      await this.evolutionService.deleteInstance(phone.instanceName);
    } catch (error) {
      this.logger.warn(`Failed to delete instance in Evolution API: ${error.message}`);
      // Continuar con eliminación en DB aunque falle en Evolution
    }

    // 3. Eliminar de DB
    await this.phoneRepository.delete(phoneId);

    this.logger.log(`Phone deleted successfully: ${phoneId}`);

    return { message: 'Phone deleted successfully' };
  }
}
