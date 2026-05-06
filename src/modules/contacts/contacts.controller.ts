import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
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

  @Get('select')
  @UseGuards(JwtAuthGuard)
  async getSelect(@Req() req) {
    return this.contactRepository.findAllSelect(req.user.tenantId);
  }

  @Patch(':id/name')
  @UseGuards(JwtAuthGuard)
  async updateName(
    @Req() req,
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    if (!name || !name.trim()) {
      throw new BadRequestException('name is required');
    }
    const result = await this.contactRepository.updateName(req.user.tenantId, id, name.trim());
    if (result.count === 0) {
      throw new BadRequestException('Contact not found or does not belong to this tenant');
    }
  }

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
