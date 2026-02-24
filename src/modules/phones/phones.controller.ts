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
import { MessageDirection, MessageSenderType, MessageStatus } from '@prisma/client';
import { FileStorageService } from '@common/file-storage/file-storage.service';

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
    private readonly fileStorageService: FileStorageService,
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

    // 5. Retornar al frontend inmediatamente, persistir en background
    this.persistMessagesInBackground(phone, conversation.id, rawMessages);

    return rawMessages;
  }

  private async persistMessagesInBackground(phone: any, conversationId: string, rawMessages: any[]) {
    try {
      // Obtener keyIds existentes
      const existingKeyIds = await this.messageRepository.findKeyIdsByConversationId(conversationId);
      const newMessages = rawMessages.filter((m) => m.key?.id && !existingKeyIds.has(m.key.id));

      if (newMessages.length === 0) return;

      for (const m of newMessages) {
        const { type, content, hasMedia } = this.evolutionService.parseMessageContent(m.message || {});
        let mediaData: { relativePath: string; fileName: string; fileSize: number; mimeType: string } | null = null;

        // Descargar media si aplica
        if (hasMedia && m.key?.id) {
          try {
            mediaData = await this.fileStorageService.downloadAndSaveMediaFromEvolution(
              this.evolutionService,
              phone.instanceName,
              phone.userId,
              conversationId,
              m.key.id,
              m.key,
            );
          } catch (err) {
            this.logger.warn(`Failed to download media for keyId ${m.key.id}: ${err.message}`);
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
          direction: m.key?.fromMe ? MessageDirection.outgoing : MessageDirection.incoming,
          senderType: m.key?.fromMe ? MessageSenderType.agent : MessageSenderType.client,
          status: MessageStatus.delivered,
          metadata: { keyId: m.key?.id },
          createdAt: m.messageTimestamp ? new Date(m.messageTimestamp * 1000) : undefined,
        });
      }

      this.logger.log(`Background: persisted ${newMessages.length} messages for conversation ${conversationId}`);
    } catch (err) {
      this.logger.error(`Background persistence failed: ${err.message}`);
    }
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
