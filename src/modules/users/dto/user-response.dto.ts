import { Exclude } from 'class-transformer';

export class UserResponseDto {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  lastLogin: Date | null;
  createdAt: Date;

  @Exclude()
  updatedAt: Date;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
