import {
  Controller,
  Get,
  Post,
  Patch,
  Query,
  UseGuards,
  Req,
  Param,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { ConversationsService } from './conversations.service';

@Controller('api/conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req,
    @Query('phoneId') phoneId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.conversationsService.findAll(req.user.tenantId, phoneId, page, limit, search);
  }

  @Get('groups/select')
  @UseGuards(JwtAuthGuard)
  async getGroupsSelect(@Req() req) {
    return this.conversationsService.getGroupsSelect(req.user.tenantId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getDetail(@Param('id') id: string, @Req() req) {
    return this.conversationsService.getDetail(id, req.user.tenantId);
  }

  @Post(':id/close')
  @UseGuards(JwtAuthGuard)
  async closeConversation(@Param('id') id: string, @Req() req) {
    return this.conversationsService.closeConversation(id, req.user.tenantId);
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  async markAsRead(@Param('id') id: string, @Req() req) {
    return this.conversationsService.markAsRead(id, req.user.tenantId);
  }
}
