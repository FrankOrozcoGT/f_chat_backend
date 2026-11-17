import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { differenceInMonths } from 'date-fns';
import { TenantSettingsRepository } from '@modules/tenant-settings/repositories/tenant-settings.repository';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { LimitErrorCode } from './limit-error-code';

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
      throw new NotFoundException({
        code: LimitErrorCode.TENANT_SETTINGS_NOT_FOUND,
        message: 'Tenant settings not found',
      });
    }

    const activePhones = await this.phoneRepository.countActiveByTenantId(tenantId);

    if (activePhones >= settings.whatsappLimit) {
      throw new ForbiddenException({
        code: LimitErrorCode.WHATSAPP_LIMIT_REACHED,
        message: `WhatsApp limit reached. Current: ${activePhones}, Limit: ${settings.whatsappLimit}`,
      });
    }
  }

  async validateCredits(
    tenantId: string,
    estimatedCredits: number,
  ): Promise<void> {
    const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    if (!settings) {
      throw new NotFoundException({
        code: LimitErrorCode.TENANT_SETTINGS_NOT_FOUND,
        message: 'Tenant settings not found',
      });
    }

    await this.checkAndResetBillingPeriod(tenantId, settings.billingPeriodStart);

    const updatedSettings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    if (!updatedSettings) {
      throw new NotFoundException({
        code: LimitErrorCode.TENANT_SETTINGS_NOT_FOUND,
        message: 'Tenant settings not found after billing period check',
      });
    }

    const projectedUsage = updatedSettings.creditsUsed + estimatedCredits;
    if (projectedUsage > updatedSettings.creditsLimit) {
      throw new ForbiddenException({
        code: LimitErrorCode.CREDITS_LIMIT_REACHED,
        message: `Credits limit reached. Current: ${updatedSettings.creditsUsed}, Estimated: ${estimatedCredits}, Limit: ${updatedSettings.creditsLimit}`,
      });
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

  async chargeLlmUsage(
    tenantId: string,
    tokensInput: number,
    tokensOutput: number,
  ): Promise<number> {
    const credits = this.calculateCreditsFromLlm(tokensInput, tokensOutput);
    await this.tenantSettingsRepository.incrementCreditsUsed(tenantId, credits);
    return credits;
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
