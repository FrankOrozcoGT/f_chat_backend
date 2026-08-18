import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactRepository } from './repositories/contact.repository';

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, ContactRepository],
})
export class ContactsModule {}
