import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ContactLabelRepository } from '../repositories/contact-label.repository';

export interface ResolvedContact {
  remoteJid: string;
  isGroup: boolean;
  clientId?: string;
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
      return { remoteJid: contactLabel.groupJid, isGroup: true };
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
}
