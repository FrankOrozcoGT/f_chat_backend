import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ClientRepository {
  constructor(private prisma: PrismaService) {}

  async findLocationById(id: string) {
    return this.prisma.client.findUnique({
      where: { id },
      select: { location: true },
    });
  }

  async updateLocation(id: string, location: string) {
    return this.prisma.client.update({
      where: { id },
      data: { location },
    });
  }
}
