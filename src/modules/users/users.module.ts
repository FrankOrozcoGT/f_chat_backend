import { Module } from '@nestjs/common';
import { UserRepository } from '@modules/users/repositories/user.repository';

@Module({
  providers: [UserRepository],
  exports: [UserRepository],
})
export class UsersModule {}
