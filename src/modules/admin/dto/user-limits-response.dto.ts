export class UserLimitsResponseDto {
  id: string;
  email: string;
  name: string;
  whatsappLimit: number;
  creditsLimit: number;
  creditsUsed: number;
  billingPeriodStart: Date;
}
