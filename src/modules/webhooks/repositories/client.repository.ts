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
  async upsert(data: {
    phoneNumber: string;
    name: string;
    profilePicUrl?: string | null;
  }) {
    return this.prisma.client.upsert({
      where: { phoneNumber: data.phoneNumber },
      create: {
        phoneNumber: data.phoneNumber,
        name: data.name,
        profilePicUrl: data.profilePicUrl ?? null,
        lastContactAt: new Date(),
      },
      update: {
        name: data.name,
        ...(data.profilePicUrl && { profilePicUrl: data.profilePicUrl }),
        lastContactAt: new Date(),
      },
    });
  }

  /**
   * Inserta muchos clientes en bulk, ignorando duplicados
   */
  async createManySkipDuplicates(
    data: {
      phoneNumber: string;
      name: string;
      profilePicUrl?: string | null;
    }[],
  ) {
    return this.prisma.client.createMany({
      data: data.map((d) => ({
        phoneNumber: d.phoneNumber,
        name: d.name,
        profilePicUrl: d.profilePicUrl ?? null,
        lastContactAt: new Date(),
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Busca múltiples clientes por lista de phoneNumbers
   */
  async findManyByPhoneNumbers(phoneNumbers: string[]) {
    return this.prisma.client.findMany({
      where: { phoneNumber: { in: phoneNumbers } },
      select: { id: true, phoneNumber: true, name: true, profilePicUrl: true },
    });
  }

  /**
   * Actualiza profilePicUrl si el cliente existe
   */
  async updateProfilePicIfExists(phoneNumber: string, profilePicUrl: string) {
    return this.prisma.client.updateMany({
      where: { phoneNumber },
      data: { profilePicUrl },
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
