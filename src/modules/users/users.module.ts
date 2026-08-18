import { Module } from '@nestjs/common';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { UsersController } from '@modules/users/users.controller';
import { InternalUsersController } from './internal-users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, InternalUsersController],
  providers: [UsersService, UserRepository],
  exports: [UserRepository],
})
export class UsersModule {}
