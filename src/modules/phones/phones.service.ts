import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PhoneStatus, MessageDirection, MessageSenderType, MessageStatus, Phone } from '@prisma/client';
import { CreatePhoneDto } from './dto/create-phone.dto';
import {
  ConnectInstanceResponseDto,
  CreateInstanceResponseDto,
} from '@common/evolution/dto/evolution-response.dto';
import { PhoneRepository } from './repositories/phone.repository';
import { PhoneResponseDto } from './dto/phone-response.dto';
import { ContactResponseDto } from './dto/contact-response.dto';
import { EvolutionService } from '@common/evolution/evolution.service';
import { LimitsService } from '@common/services/limits.service';
import { ClientRepository } from '@common/messaging/repositories/client.repository';
import { phoneFromJid } from '@common/utils/whatsapp-jid';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { MessageRepository } from '@common/messaging/repositories/message.repository';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { errorMessage } from '@common/errors/error-message';
import { PhoneErrorCode } from './phone-error-code';

@Injectable()
export class PhonesService {
  private readonly logger = new Logger(PhonesService.name);

  constructor(
    private readonly phoneRepository: PhoneRepository,
    private readonly evolutionService: EvolutionService,
    private readonly limitsService: LimitsService,
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly fileStorageService: FileStorageService,
  ) {}

  validateInstanceName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException({
        code: PhoneErrorCode.INSTANCE_NAME_EMPTY,
        message: 'Instance name cannot be empty',
      });
    }

    if (name.length > 50) {
      throw new BadRequestException({
        code: PhoneErrorCode.INSTANCE_NAME_TOO_LONG,
        message: 'Instance name cannot exceed 50 characters',
      });
    }
  }

  buildPhoneData(
    dto: CreatePhoneDto,
    evolutionData: CreateInstanceResponseDto,
    tenantId: string,
  ) {
    return {
      tenantId,
      instanceName: dto.instanceName,
      // Use instanceName for webhook matching (Evolution sends instanceName in webhooks)
      evolutionInstanceId:
        evolutionData.instance.instanceName || dto.instanceName,
      status: PhoneStatus.pending,
      phoneNumber: '',
      qrCode: evolutionData.qrcode?.code,
    };
  }

  async findAll(tenantId: string): Promise<PhoneResponseDto[]> {
    const phones = await this.phoneRepository.findAllByTenantId(tenantId);
    return phones.map((phone) => new PhoneResponseDto(phone));
  }

  async create(dto: CreatePhoneDto, tenantId: string) {
    this.validateInstanceName(dto.instanceName);
    await this.limitsService.validateWhatsAppLimit(tenantId);

    let evolutionData: CreateInstanceResponseDto;
    try {
      evolutionData = await this.evolutionService.createInstance(
        dto.instanceName,
        { qrcode: true },
      );
    } catch (error) {
      this.logger.error(
        `Failed to create instance in Evolution API: ${errorMessage(error)}`,
      );
      throw new BadGatewayException({
        code: PhoneErrorCode.CREATE_INSTANCE_FAILED,
        message: 'Failed to create WhatsApp instance',
      });
    }

    const phoneData = this.buildPhoneData(dto, evolutionData, tenantId);
    const phone = await this.phoneRepository.create(phoneData);

    this.logger.log(`Phone instance created successfully: ${phone.id}`);

    return this.toPhoneQrResponse(phone, evolutionData.qrcode?.code || null);
  }

  private async assertOwnedPhone(phoneId: string, tenantId: string): Promise<Phone> {
    const phone = await this.phoneRepository.findByIdAndTenantId(
      phoneId,
      tenantId,
    );
    if (!phone) {
      throw new NotFoundException({
        code: PhoneErrorCode.NOT_FOUND,
        message: 'Phone not found',
      });
    }
    return phone;
  }

  private async assertReconnectable(
    phone: Phone,
    tenantId: string,
  ): Promise<void> {
    if (phone.status === PhoneStatus.connected) {
      throw new BadRequestException({
        code: PhoneErrorCode.ALREADY_CONNECTED,
        message: 'Phone is already connected',
      });
    }
    if (phone.status === PhoneStatus.disconnected) {
      await this.limitsService.validateWhatsAppLimit(tenantId);
    }
  }

  async reconnect(phoneId: string, tenantId: string) {
    const phone = await this.assertOwnedPhone(phoneId, tenantId);
    await this.assertReconnectable(phone, tenantId);

    let connection: ConnectInstanceResponseDto;
    try {
      connection = await this.evolutionService.connectInstance(
        phone.instanceName,
      );
    } catch (error) {
      this.logger.error(
        `Failed to reconnect instance in Evolution API: ${errorMessage(error)}`,
      );
      throw new BadGatewayException({
        code: PhoneErrorCode.RECONNECT_FAILED,
        message: 'Failed to reconnect WhatsApp instance',
      });
    }
    if (!connection.code) {
      throw new BadGatewayException({
        code: PhoneErrorCode.QR_UNAVAILABLE,
        message: 'WhatsApp did not return a QR code',
      });
    }

    const updated = await this.phoneRepository.updateStatus(
      phone.id,
      PhoneStatus.pending,
      { qrCode: connection.code },
    );

    this.logger.log(`Phone reconnection started: ${phone.id}`);

    return this.toPhoneQrResponse(updated, connection.code);
  }

  private toPhoneQrResponse(phone: Phone, qrCode: string | null) {
    return { phone: new PhoneResponseDto(phone), qrCode };
  }

  async findContacts(phoneId: string, tenantId: string): Promise<ContactResponseDto[]> {
    const phone = await this.assertOwnedPhone(phoneId, tenantId);

    let rawContacts: any[];
    try {
      rawContacts = await this.evolutionService.findContacts(phone.instanceName);
    } catch (error) {
      this.logger.error(
        `Failed to get contacts for phone ${phoneId}: ${errorMessage(error)}`,
      );
      throw new BadGatewayException({
        code: PhoneErrorCode.CONTACTS_UNAVAILABLE,
        message: 'Failed to retrieve contacts from WhatsApp',
      });
    }

    const withPic = rawContacts.filter((c) => c.profilePicUrl).length;
    this.logger.log(
      `[findContacts] total=${rawContacts.length} withProfilePic=${withPic}`,
    );
    if (rawContacts.length > 0) {
      this.logger.log(
        `[findContacts] sample[0] keys=${Object.keys(rawContacts[0]).join(',')} profilePicUrl=${rawContacts[0].profilePicUrl}`,
      );
    }

    return rawContacts.map(
      (c) =>
        new ContactResponseDto({
          id: c.remoteJid,
          name: c.pushName || c.remoteJid.split('@')[0],
          phoneNumber: c.remoteJid.split('@')[0],
          profilePicUrl: c.profilePicUrl || null,
        }),
    );
  }

  async findMessages(phoneId: string, remoteJid: string, tenantId: string) {
    const phone = await this.assertOwnedPhone(phoneId, tenantId);

    let rawMessages: any[];
    try {
      rawMessages = await this.evolutionService.findMessages(phone.instanceName, remoteJid);
    } catch (error) {
      this.logger.error(
        `Failed to get messages for phone ${phoneId}: ${errorMessage(error)}`,
      );
      throw new BadGatewayException({
        code: PhoneErrorCode.MESSAGES_UNAVAILABLE,
        message: 'Failed to retrieve messages from WhatsApp',
      });
    }

    if (rawMessages.length === 0) {
      return [];
    }

    const phoneNumber = phoneFromJid(remoteJid);
    const firstWithName = rawMessages.find((m) => m.pushName && !m.key?.fromMe);
    const client = await this.clientRepository.upsert({
      phoneNumber,
      name: firstWithName?.pushName || phoneNumber,
    });

    const conversation = await this.conversationRepository.upsertIndividual({
      phoneId,
      clientId: client.id,
      isActive: true,
    });

    // Retornar al frontend inmediatamente, persistir en background
    this.persistMessagesInBackground(phone, conversation.id, rawMessages);

    return rawMessages;
  }

  private async persistMessagesInBackground(
    phone: Phone,
    conversationId: string,
    rawMessages: any[],
  ) {
    try {
      const existingKeyIds =
        await this.messageRepository.findKeyIdsByConversationId(conversationId);
      const newMessages = rawMessages.filter(
        (m) => m.key?.id && !existingKeyIds.has(m.key.id),
      );

      if (newMessages.length === 0) return;

      const parsed = newMessages.map((m) => ({
        m,
        ...this.evolutionService.parseMessageContent(m.message || {}),
      }));

      const withoutMedia = parsed.filter((p) => !p.hasMedia);
      const withMedia = parsed.filter((p) => p.hasMedia);

      if (withoutMedia.length > 0) {
        await this.messageRepository.createManyFull(
          withoutMedia.map((p) => ({
            conversationId,
            type: p.type,
            content: p.content,
            mediaUrl: null,
            direction: p.m.key?.fromMe
              ? MessageDirection.outgoing
              : MessageDirection.incoming,
            senderType: p.m.key?.fromMe
              ? MessageSenderType.agent
              : MessageSenderType.client,
            status: MessageStatus.delivered,
            metadata: { keyId: p.m.key?.id },
            createdAt: p.m.messageTimestamp
              ? new Date(p.m.messageTimestamp * 1000)
              : undefined,
          })),
        );
      }

      // Loop individual para mensajes con media (requieren descarga)
      for (const p of withMedia) {
        let mediaData: {
          relativePath: string;
          fileName: string;
          fileSize: number;
          mimeType: string;
        } | null = null;

        if (p.m.key?.id) {
          try {
            mediaData =
              await this.fileStorageService.downloadAndSaveMediaFromEvolution(
                this.evolutionService,
                phone.instanceName,
                phone.tenantId,
                conversationId,
                p.m.key.id,
                p.m.key,
              );
          } catch (err) {
            this.logger.warn(
              `Failed to download media for keyId ${p.m.key.id}: ${errorMessage(err)}`,
            );
          }
        }

        await this.messageRepository.create({
          conversationId,
          type: p.type,
          content: p.content,
          mediaUrl: mediaData?.relativePath || null,
          fileName: mediaData?.fileName || null,
          fileSize: mediaData?.fileSize || null,
          mimeType: mediaData?.mimeType || null,
          direction: p.m.key?.fromMe
            ? MessageDirection.outgoing
            : MessageDirection.incoming,
          senderType: p.m.key?.fromMe
            ? MessageSenderType.agent
            : MessageSenderType.client,
          status: MessageStatus.delivered,
          metadata: { keyId: p.m.key?.id },
          createdAt: p.m.messageTimestamp
            ? new Date(p.m.messageTimestamp * 1000)
            : undefined,
        });
      }

      this.logger.log(
        `Background: persisted ${newMessages.length} messages for conversation ${conversationId} (${withoutMedia.length} bulk, ${withMedia.length} with media)`,
      );
    } catch (err) {
      this.logger.error(
        `Background persistence failed for conversation ${conversationId}: ${errorMessage(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  async delete(phoneId: string, tenantId: string) {
    const phone = await this.assertOwnedPhone(phoneId, tenantId);

    try {
      await this.evolutionService.deleteInstance(phone.instanceName);
    } catch (error) {
      this.logger.warn(
        `Failed to delete instance in Evolution API: ${errorMessage(error)}`,
      );
      // Continuar con eliminación en DB aunque falle en Evolution
    }

    await this.phoneRepository.delete(phoneId);

    this.logger.log(`Phone deleted successfully: ${phoneId}`);

    return { message: 'Phone deleted successfully' };
  }
}
