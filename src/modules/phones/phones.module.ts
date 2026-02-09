import { Module } from '@nestjs/common';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { PhonesController } from '@modules/phones/phones.controller';

@Module({
  controllers: [PhonesController],
  providers: [PhoneRepository],
  exports: [PhoneRepository],
})
export class PhonesModule {}
