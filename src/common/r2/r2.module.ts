import { Global, Module } from '@nestjs/common';
import { R2Repository } from './r2.repository';
import { R2Service } from './r2.service';

@Global()
@Module({
  providers: [R2Repository, R2Service],
  exports: [R2Service],
})
export class R2Module {}
