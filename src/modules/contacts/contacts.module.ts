import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactRepository } from './repositories/contact.repository';

@Module({
  controllers: [ContactsController],
  providers: [ContactRepository],
})
export class ContactsModule {}
