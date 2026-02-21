export class ContactResponseDto {
  id: string;
  name: string;
  phoneNumber: string;

  constructor(partial: { id: string; name: string; phoneNumber: string }) {
    this.id = partial.id;
    this.name = partial.name;
    this.phoneNumber = partial.phoneNumber;
  }
}
