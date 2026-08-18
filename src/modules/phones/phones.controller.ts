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
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { PhonesService } from './phones.service';
import { PhoneResponseDto } from './dto/phone-response.dto';
import { CreatePhoneDto } from './dto/create-phone.dto';
import { ContactResponseDto } from './dto/contact-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';

@Controller('api/phones')
@UseInterceptors(ClassSerializerInterceptor)
export class PhonesController {
  constructor(private readonly phonesService: PhonesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Req() req): Promise<PhoneResponseDto[]> {
    return this.phonesService.findAll(req.user.tenantId);
  }

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreatePhoneDto, @Req() req) {
    return this.phonesService.create(dto, req.user.tenantId);
  }

  @Get(':id/contacts')
  @UseGuards(JwtAuthGuard)
  async findContacts(
    @Param('id') phoneId: string,
    @Req() req,
  ): Promise<ContactResponseDto[]> {
    return this.phonesService.findContacts(phoneId, req.user.tenantId);
  }

  @Get(':id/messages/:remoteJid')
  @UseGuards(JwtAuthGuard)
  async findMessages(
    @Param('id') phoneId: string,
    @Param('remoteJid') remoteJid: string,
    @Req() req,
  ): Promise<MessageResponseDto[]> {
    return this.phonesService.findMessages(phoneId, remoteJid, req.user.tenantId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') phoneId: string, @Req() req) {
    return this.phonesService.delete(phoneId, req.user.tenantId);
  }
}
