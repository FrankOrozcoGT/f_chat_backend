import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { UserRepository } from './repositories/user.repository';

@Controller('internal/users')
@UseGuards(InternalGuard)
export class InternalUsersController {
  constructor(private readonly userRepository: UserRepository) {}

  @Get(':id')
  async getUser(@Param('id') id: string) {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return {
      id: user.id,
      creditsUsed: user.creditsUsed,
      creditsLimit: user.creditsLimit,
    };
  }

  @Patch(':id/credits')
  async incrementCredits(
    @Param('id') id: string,
    @Body('credits') credits: number,
  ) {
    await this.userRepository.incrementCreditsUsed(id, credits);
  }
}
