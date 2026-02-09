import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { PhonesController } from '@modules/phones/phones.controller';
import { PhonesService } from '@modules/phones/phones.service';

@Module({
  imports: [EvolutionModule, ConfigModule],
  controllers: [PhonesController],
  providers: [PhoneRepository, PhonesService],
  exports: [PhoneRepository],
})
export class PhonesModule {}
