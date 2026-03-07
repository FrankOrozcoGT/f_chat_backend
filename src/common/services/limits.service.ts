import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { differenceInMonths } from 'date-fns';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';

@Injectable()
export class LimitsService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly phoneRepository: PhoneRepository,
    private readonly configService: ConfigService,
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

  async validateCredits(
    userId: string,
    estimatedCredits: number,
  ): Promise<void> {
    // 1. Obtener usuario
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. Verificar y resetear periodo de facturación si es necesario
    await this.checkAndResetBillingPeriod(userId, user.billingPeriodStart);

    // 3. Obtener usuario actualizado después del posible reset
    const updatedUser = await this.userRepository.findById(userId);
    if (!updatedUser) {
      throw new NotFoundException('User not found after billing period check');
    }

    // 4. Validar contra límite
    const projectedUsage = updatedUser.creditsUsed + estimatedCredits;
    if (projectedUsage > updatedUser.creditsLimit) {
      throw new ForbiddenException(
        `Credits limit reached. Current: ${updatedUser.creditsUsed}, Estimated: ${estimatedCredits}, Limit: ${updatedUser.creditsLimit}`,
      );
    }
  }

  async checkAndResetBillingPeriod(
    userId: string,
    billingPeriodStart: Date,
  ): Promise<void> {
    const monthsDiff = differenceInMonths(new Date(), billingPeriodStart);

    if (monthsDiff >= 1) {
      await this.userRepository.resetBillingPeriod(userId);
    }
  }

  calculateCreditsFromTokens(tokens: number): number {
    const tokensPerCredit = this.configService.get<number>(
      'TOKENS_PER_CREDIT',
      1000,
    );
    return tokens / tokensPerCredit;
  }

  calculateCreditsFromLlm(tokensInput: number, tokensOutput: number): number {
    const tokensPerCredit = this.configService.get<number>(
      'TOKENS_PER_CREDIT',
      1000,
    );
    const inputWeight = this.configService.get<number>(
      'CREDITS_INPUT_WEIGHT',
      0.33,
    );
    const weightedTokens =
      tokensInput * inputWeight + tokensOutput;
    return weightedTokens / tokensPerCredit;
  }

  calculateCreditsFromSeconds(seconds: number): number {
    const tokensPerSecond = this.configService.get<number>(
      'TOKENS_PER_AUDIO_SECOND',
      5,
    );
    const tokensPerCredit = this.configService.get<number>(
      'TOKENS_PER_CREDIT',
      1000,
    );
    return (seconds * tokensPerSecond) / tokensPerCredit;
  }

  calculateCreditsFromChars(chars: number): number {
    const charsPerToken = this.configService.get<number>('CHARS_PER_TOKEN', 4);
    const tokensPerCredit = this.configService.get<number>(
      'TOKENS_PER_CREDIT',
      1000,
    );
    return chars / charsPerToken / tokensPerCredit;
  }
}
