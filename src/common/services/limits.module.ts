import { Module, forwardRef } from '@nestjs/common';
import { LimitsService } from './limits.service';
import { UsersModule } from '@modules/users/users.module';
import { PhonesModule } from '@modules/phones/phones.module';

@Module({
  imports: [UsersModule, forwardRef(() => PhonesModule)],
  providers: [LimitsService],
  exports: [LimitsService],
})
export class LimitsModule {}
