import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { ContactsService } from './contacts.service';

@Controller('api/contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get('select')
  @UseGuards(JwtAuthGuard)
  async getSelect(@Req() req) {
    return this.contactsService.getSelect(req.user.tenantId);
  }

  @Patch(':id/name')
  @UseGuards(JwtAuthGuard)
  async updateName(
    @Req() req,
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.contactsService.updateName(req.user.tenantId, id, name);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async search(@Req() req, @Query('search') search?: string) {
    return this.contactsService.search(req.user.tenantId, search);
  }
}
