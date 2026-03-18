import { Module, forwardRef } from '@nestjs/common';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { UsersController } from '@modules/users/users.controller';
import { InternalUsersController } from './internal-users.controller';
import { AuthModule } from '@modules/auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UsersController, InternalUsersController],
  providers: [UserRepository],
  exports: [UserRepository],
})
export class UsersModule {}
