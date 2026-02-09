import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class ClientRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * Crea o actualiza un cliente por phoneNumber
   * @param data - Datos del cliente
   * @returns Cliente creado o actualizado
   */
  async upsert(data: { phoneNumber: string; name: string }) {
    return this.prisma.client.upsert({
      where: { phoneNumber: data.phoneNumber },
      create: {
        phoneNumber: data.phoneNumber,
        name: data.name,
        lastContactAt: new Date(),
      },
      update: {
        name: data.name,
        lastContactAt: new Date(),
      },
    });
  }

  /**
   * Busca un cliente por ID
   * @param id - ID del cliente
   * @returns Cliente o null
   */
  async findById(id: string) {
    return this.prisma.client.findUnique({
      where: { id },
    });
  }
}
