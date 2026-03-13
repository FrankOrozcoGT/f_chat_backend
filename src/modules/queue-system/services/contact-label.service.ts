import { Injectable, NotFoundException } from '@nestjs/common';
import { ContactLabelRepository } from '../repositories/contact-label.repository';

@Injectable()
export class ContactLabelService {
  constructor(private readonly contactLabelRepo: ContactLabelRepository) {}

  async resolve(userId: string, label: string): Promise<{ clientId: string; phoneNumber: string }> {
    const contactLabel = await this.contactLabelRepo.findByUserIdAndLabel(userId, label);
    if (!contactLabel) {
      throw new NotFoundException(`ContactLabel "${label}" not found for user ${userId}`);
    }
    return {
      clientId: contactLabel.client.id,
      phoneNumber: contactLabel.client.phoneNumber,
    };
  }

  async isLabeledContact(phoneNumber: string): Promise<boolean> {
    const labels = await this.contactLabelRepo.findByClientPhone(phoneNumber);
    return labels.length > 0;
  }

  async findLabelsByClientPhone(phoneNumber: string) {
    return this.contactLabelRepo.findByClientPhone(phoneNumber);
  }
}
