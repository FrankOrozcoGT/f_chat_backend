import { Global, Module } from '@nestjs/common';
import { LangSmithService } from './langsmith.service';

@Global()
@Module({
  providers: [LangSmithService],
  exports: [LangSmithService],
})
export class LangSmithModule {}
