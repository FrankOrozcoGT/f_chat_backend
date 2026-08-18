import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ContactLabelRepository } from '../repositories/contact-label.repository';
import { CreateLabelDto } from '../dto/create-label.dto';
import { UpdateLabelDto } from '../dto/update-label.dto';

export interface ResolvedContact {
  remoteJid: string;
  isGroup: boolean;
  clientId?: string;
  clientPhone?: string; // populated when isGroup=true, the individual phone of the labeled contact
}

@Injectable()
export class ContactLabelService {
  constructor(private readonly contactLabelRepo: ContactLabelRepository) {}

  async resolve(tenantId: string, label: string): Promise<ResolvedContact> {
    const contactLabel = await this.contactLabelRepo.findByTenantIdAndLabel(tenantId, label);
    if (!contactLabel) {
      throw new NotFoundException(`ContactLabel "${label}" not found for user ${tenantId}`);
    }

    if (contactLabel.groupJid) {
      return {
        remoteJid: contactLabel.groupJid,
        isGroup: true,
        clientPhone: contactLabel.client?.phoneNumber,
        clientId: contactLabel.client?.id,
      };
    }

    if (contactLabel.client) {
      return {
        remoteJid: `${contactLabel.client.phoneNumber}@s.whatsapp.net`,
        isGroup: false,
        clientId: contactLabel.client.id,
      };
    }

    throw new BadRequestException(`ContactLabel "${label}" has neither clientId nor groupJid`);
  }

  async isLabeledContact(phoneNumber: string): Promise<boolean> {
    const labels = await this.contactLabelRepo.findByClientPhone(phoneNumber);
    return labels.length > 0;
  }

  async findLabelsByClientPhone(phoneNumber: string) {
    return this.contactLabelRepo.findByClientPhone(phoneNumber);
  }

  async getLabels(tenantId: string) {
    return this.contactLabelRepo.findByTenantId(tenantId);
  }

  async createLabel(tenantId: string, dto: CreateLabelDto) {
    const existing = await this.contactLabelRepo.findByTenantIdAndLabel(tenantId, dto.label);
    if (existing) throw new ConflictException(`Label "${dto.label}" already exists for this tenant`);
    return this.contactLabelRepo.create(tenantId, dto);
  }

  async updateLabel(id: string, tenantId: string, dto: UpdateLabelDto) {
    return this.contactLabelRepo.updateById(id, tenantId, dto);
  }

  async deleteLabel(id: string, tenantId: string) {
    return this.contactLabelRepo.deleteById(id, tenantId);
  }
}
