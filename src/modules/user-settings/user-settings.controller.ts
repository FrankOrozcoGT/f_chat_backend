import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { UserSettingsRepository } from './repositories/user-settings.repository';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsResponseDto } from './dto/settings-response.dto';

@Controller('api/users/settings')
export class UserSettingsController {
  private readonly logger = new Logger(UserSettingsController.name);

  constructor(
    private readonly userSettingsRepository: UserSettingsRepository,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async get(@Req() req): Promise<SettingsResponseDto> {
    const userId = req.user.id;
    this.logger.log(`GET /api/users/settings - userId: ${userId}`);

    // Upsert con defaults si no existe
    const settings = await this.userSettingsRepository.upsert(userId, {});

    return new SettingsResponseDto(settings);
  }

  @Patch()
  @UseGuards(JwtAuthGuard)
  async update(
    @Req() req,
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsResponseDto> {
    const userId = req.user.id;
    this.logger.log(
      `PATCH /api/users/settings - userId: ${userId}, data: ${JSON.stringify(dto)}`,
    );

    const settings = await this.userSettingsRepository.upsert(userId, dto);

    return new SettingsResponseDto(settings);
  }
}
