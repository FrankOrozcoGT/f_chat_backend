import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { UserSettingsRepository } from './repositories/user-settings.repository';

@Controller('internal/user-settings')
@UseGuards(InternalGuard)
export class InternalUserSettingsController {
  constructor(
    private readonly userSettingsRepository: UserSettingsRepository,
  ) {}

  @Get(':userId')
  async getByUserId(@Param('userId') userId: string) {
    const settings = await this.userSettingsRepository.findByUserId(userId);
    return settings ?? { analysisMode: 'manual', messageLimit: 30 };
  }
}
