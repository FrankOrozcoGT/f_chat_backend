import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { ContactRepository } from './repositories/contact.repository';
import { ContactSearchResponseDto } from './dto/contact-search-response.dto';

@Controller('api/contacts')
export class ContactsController {
  private readonly logger = new Logger(ContactsController.name);

  constructor(private readonly contactRepository: ContactRepository) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async search(@Req() req, @Query('search') search?: string) {
    if (!search || search.trim().length < 2) {
      throw new BadRequestException('Search query must be at least 2 characters');
    }

    const tenantId = req.user.tenantId;
    const trimmed = search.trim();

    this.logger.log(`GET /api/contacts?search=${trimmed} - tenantId: ${tenantId}`);

    const clients = await this.contactRepository.searchWithConversations(tenantId, trimmed);

    return clients.map((client) => new ContactSearchResponseDto(client as any));
  }
}
