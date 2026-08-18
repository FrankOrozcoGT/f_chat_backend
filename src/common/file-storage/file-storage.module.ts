import { Module, Global } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { StorageController } from './storage.controller';

@Global()
@Module({
  controllers: [StorageController],
  providers: [FileStorageService],
  exports: [FileStorageService],
})
export class FileStorageModule {}
