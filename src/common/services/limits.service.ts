import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';

@Injectable()
export class LimitsService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly phoneRepository: PhoneRepository,
  ) {}

  async validateWhatsAppLimit(userId: string): Promise<void> {
    // 1. Obtener usuario con sus límites
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. Contar phones activos del usuario (pending + connected)
    const activePhones = await this.phoneRepository.countActiveByUserId(userId);

    // 3. Validar contra límite
    if (activePhones >= user.whatsappLimit) {
      throw new ForbiddenException(
        `WhatsApp limit reached. Current: ${activePhones}, Limit: ${user.whatsappLimit}`,
      );
    }
  }
}
