import {
  Controller,
  Get,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { SystemAdminGuard } from '@common/guards/system-admin.guard';
import { UsersService } from './users.service';
import { UserResponseDto } from './dto/user-response.dto';

@Controller('api/users')
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  async findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }
}
