export class ContactResponseDto {
  id: string;
  name: string;
  phoneNumber: string;
  profilePicUrl: string | null;

  constructor(partial: {
    id: string;
    name: string;
    phoneNumber: string;
    profilePicUrl?: string | null;
  }) {
    this.id = partial.id;
    this.name = partial.name;
    this.phoneNumber = partial.phoneNumber;
    this.profilePicUrl = partial.profilePicUrl ?? null;
  }
}
