import { PhoneStatus } from '@prisma/client';

export class PhoneResponseDto {
  id: string;
  phoneNumber: string;
  instanceName: string;
  status: PhoneStatus;
  qrCode: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  lastConnected: Date | null;

  constructor(partial: Partial<PhoneResponseDto>) {
    Object.assign(this, partial);
  }
}
