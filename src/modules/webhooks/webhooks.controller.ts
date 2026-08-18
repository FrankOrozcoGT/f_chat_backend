import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import type { EvolutionWebhookEvent } from './types/evolution-webhook.types';

@Controller('whatsapp/webhook')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() webhookData: EvolutionWebhookEvent) {
    return this.webhooksService.handleWebhook(webhookData);
  }
}
