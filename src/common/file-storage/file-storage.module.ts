import { Module, Global } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';

@Global()
@Module({
  providers: [FileStorageService],
  exports: [FileStorageService],
})
export class FileStorageModule {}
