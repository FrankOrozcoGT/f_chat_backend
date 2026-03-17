import {
  Controller,
  Get,
  Param,
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
      email: user.email,
      name: user.name,
    };
  }
}
