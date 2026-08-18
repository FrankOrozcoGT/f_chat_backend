import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { ContactLabelService } from './services/contact-label.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';

interface AuthUser {
  id: string;
  tenantId: string;
}

@Controller('api/queue')
@UseGuards(JwtAuthGuard)
export class QueueSystemController {
  constructor(private readonly contactLabelService: ContactLabelService) {}

  @Get('labels')
  getLabels(@CurrentUser() user: AuthUser) {
    return this.contactLabelService.getLabels(user.tenantId);
  }

  @Post('labels')
  async createLabel(@CurrentUser() user: AuthUser, @Body() dto: CreateLabelDto) {
    return this.contactLabelService.createLabel(user.tenantId, dto);
  }

  @Put('labels/:id')
  updateLabel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.contactLabelService.updateLabel(id, user.tenantId, dto);
  }

  @Delete('labels/:id')
  deleteLabel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contactLabelService.deleteLabel(id, user.tenantId);
  }
}
