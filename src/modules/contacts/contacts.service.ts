import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ContactRepository } from './repositories/contact.repository';
import { ContactSearchResponseDto } from './dto/contact-search-response.dto';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private readonly contactRepository: ContactRepository) {}

  async getSelect(tenantId: string) {
    return this.contactRepository.findAllSelect(tenantId);
  }

  async updateName(tenantId: string, id: string, name: string): Promise<void> {
    if (!name || !name.trim()) {
      throw new BadRequestException('name is required');
    }
    const result = await this.contactRepository.updateName(tenantId, id, name.trim());
    if (result.count === 0) {
      throw new BadRequestException('Contact not found or does not belong to this tenant');
    }
  }

  async search(tenantId: string, search: string | undefined): Promise<ContactSearchResponseDto[]> {
    if (!search || search.trim().length < 2) {
      throw new BadRequestException('Search query must be at least 2 characters');
    }

    const trimmed = search.trim();
    this.logger.log(`search "${trimmed}" - tenantId: ${tenantId}`);

    const clients = await this.contactRepository.searchWithConversations(tenantId, trimmed);

    return clients.map((client) => new ContactSearchResponseDto(client));
  }
}
