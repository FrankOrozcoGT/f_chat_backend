import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Phone } from '@prisma/client';

@Injectable()
export class PhoneRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUserId(userId: string): Promise<Phone[]> {
    return this.prisma.phone.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
