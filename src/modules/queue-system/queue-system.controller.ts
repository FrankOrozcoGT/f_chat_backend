import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { ContactLabelRepository } from './repositories/contact-label.repository';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';

interface AuthUser {
  id: string;
  tenantId: string;
}

@Controller('api/queue')
@UseGuards(JwtAuthGuard)
export class QueueSystemController {
  constructor(private readonly contactLabelRepo: ContactLabelRepository) {}

  @Get('labels')
  getLabels(@CurrentUser() user: AuthUser) {
    return this.contactLabelRepo.findByTenantId(user.tenantId);
  }

  @Post('labels')
  async createLabel(@CurrentUser() user: AuthUser, @Body() dto: CreateLabelDto) {
    const existing = await this.contactLabelRepo.findByTenantIdAndLabel(user.tenantId, dto.label);
    if (existing) throw new ConflictException(`Label "${dto.label}" already exists for this tenant`);
    return this.contactLabelRepo.create(user.tenantId, dto);
  }

  @Put('labels/:id')
  updateLabel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.contactLabelRepo.updateById(id, user.tenantId, dto);
  }

  @Delete('labels/:id')
  deleteLabel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contactLabelRepo.deleteById(id, user.tenantId);
  }
}
