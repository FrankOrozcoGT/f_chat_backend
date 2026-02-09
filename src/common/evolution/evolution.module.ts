import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { EvolutionService } from './evolution.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [EvolutionService],
  exports: [EvolutionService],
})
export class EvolutionModule {}
