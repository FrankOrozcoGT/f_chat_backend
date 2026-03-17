import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { differenceInMonths } from 'date-fns';
import { TenantSettingsRepository } from '@modules/tenant-settings/repositories/tenant-settings.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';

@Injectable()
export class LimitsService {
  constructor(
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly phoneRepository: PhoneRepository,
    private readonly configService: ConfigService,
  ) {}

  async validateWhatsAppLimit(tenantId: string): Promise<void> {
    const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    if (!settings) {
      throw new NotFoundException('Tenant settings not found');
    }

    const activePhones = await this.phoneRepository.countActiveByTenantId(tenantId);

    if (activePhones >= settings.whatsappLimit) {
      throw new ForbiddenException(
        `WhatsApp limit reached. Current: ${activePhones}, Limit: ${settings.whatsappLimit}`,
      );
    }
  }

  async validateCredits(
    tenantId: string,
    estimatedCredits: number,
  ): Promise<void> {
    const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    if (!settings) {
      throw new NotFoundException('Tenant settings not found');
    }

    await this.checkAndResetBillingPeriod(tenantId, settings.billingPeriodStart);

    const updatedSettings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    if (!updatedSettings) {
      throw new NotFoundException('Tenant settings not found after billing period check');
    }

    const projectedUsage = updatedSettings.creditsUsed + estimatedCredits;
    if (projectedUsage > updatedSettings.creditsLimit) {
      throw new ForbiddenException(
        `Credits limit reached. Current: ${updatedSettings.creditsUsed}, Estimated: ${estimatedCredits}, Limit: ${updatedSettings.creditsLimit}`,
      );
    }
  }

  async checkAndResetBillingPeriod(
    tenantId: string,
    billingPeriodStart: Date,
  ): Promise<void> {
    const monthsDiff = differenceInMonths(new Date(), billingPeriodStart);

    if (monthsDiff >= 1) {
      await this.tenantSettingsRepository.resetBillingPeriod(tenantId);
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
