import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  CreateInstanceResponseDto,
  SendMessageResponseDto,
  WebhookResponseDto,
} from './dto/evolution-response.dto';

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const apiUrl = this.configService.get<string>('EVOLUTION_API_URL');
    const apiKey = this.configService.get<string>('EVOLUTION_API_KEY');

    if (!apiUrl || !apiKey) {
      throw new Error('EVOLUTION_API_URL and EVOLUTION_API_KEY must be defined in .env');
    }

    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  private getHeaders() {
    return {
      apikey: this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Crear instancia - POST /instance/create
   * Timeout: 10s, NO retry
   */
  async createInstance(
    instanceName: string,
    options?: {
      qrcode?: boolean;
      webhookUrl?: string;
      webhookEvents?: string[];
    },
  ): Promise<CreateInstanceResponseDto> {
    try {
      this.logger.log(`Creating instance: ${instanceName}`);

      const body: any = {
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
      };

      if (options?.qrcode !== undefined) {
        body.qrcode = options.qrcode;
      }

      if (options?.webhookUrl) {
        body.webhook = {
          url: options.webhookUrl,
          enabled: true,
          events: options.webhookEvents || ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
        };
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/instance/create`,
          body,
          {
            headers: this.getHeaders(),
            timeout: 10000,
          },
        ),
      );

      this.logger.log(`Instance created successfully: ${instanceName}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to create instance: ${instanceName}`, error.message);
      throw new BadGatewayException('Failed to create WhatsApp instance');
    }
  }


  /**
   * Enviar mensaje de texto - POST /message/sendText
   * Timeout: 8s, retry x3 con exponential backoff (1s, 2s, 4s)
   */
  async sendTextMessage(
    instanceId: string,
    phoneNumber: string,
    text: string,
    attempt = 1,
  ): Promise<SendMessageResponseDto> {
    const maxAttempts = 4; // 1 inicial + 3 retries
    const baseDelay = 1000;
    const retryDelay = baseDelay * Math.pow(2, attempt - 1); // Exponential: 1s, 2s, 4s, 8s

    try {
      this.logger.log(
        `Sending text message to ${phoneNumber} via ${instanceId} (attempt ${attempt}/${maxAttempts})`,
      );

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/message/sendText/${instanceId}`,
          {
            number: phoneNumber,
            text,
          },
          {
            headers: this.getHeaders(),
            timeout: 8000,
          },
        ),
      );

      this.logger.log(`Message sent successfully to ${phoneNumber}`);
      return response.data;
    } catch (error) {
      this.logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed for sendTextMessage to ${phoneNumber}`,
        error.message,
      );

      if (attempt < maxAttempts) {
        this.logger.log(`Retrying in ${retryDelay}ms...`);
        await this.delay(retryDelay);
        return this.sendTextMessage(instanceId, phoneNumber, text, attempt + 1);
      }

      this.logger.error(`All attempts failed for sendTextMessage to ${phoneNumber}`);
      throw new BadGatewayException('Failed to send message after retries');
    }
  }

  /**
   * Enviar mensaje con media - POST /message/sendMedia
   * Timeout: 8s, retry x3 con exponential backoff (1s, 2s, 4s)
   */
  async sendMediaMessage(
    instanceId: string,
    phoneNumber: string,
    mediaUrl: string,
    caption?: string,
    attempt = 1,
  ): Promise<SendMessageResponseDto> {
    const maxAttempts = 4; // 1 inicial + 3 retries
    const baseDelay = 1000;
    const retryDelay = baseDelay * Math.pow(2, attempt - 1); // Exponential: 1s, 2s, 4s, 8s

    try {
      this.logger.log(
        `Sending media message to ${phoneNumber} via ${instanceId} (attempt ${attempt}/${maxAttempts})`,
      );

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/message/sendMedia/${instanceId}`,
          {
            number: phoneNumber,
            mediaUrl,
            caption,
          },
          {
            headers: this.getHeaders(),
            timeout: 8000,
          },
        ),
      );

      this.logger.log(`Media message sent successfully to ${phoneNumber}`);
      return response.data;
    } catch (error) {
      this.logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed for sendMediaMessage to ${phoneNumber}`,
        error.message,
      );

      if (attempt < maxAttempts) {
        this.logger.log(`Retrying in ${retryDelay}ms...`);
        await this.delay(retryDelay);
        return this.sendMediaMessage(instanceId, phoneNumber, mediaUrl, caption, attempt + 1);
      }

      this.logger.error(`All attempts failed for sendMediaMessage to ${phoneNumber}`);
      throw new BadGatewayException('Failed to send media message after retries');
    }
  }

  /**
   * Configurar webhook - POST /webhook/set/:instanceName
   * Timeout: 5s, retry x2 con delay 2s
   */
  async setWebhook(
    instanceName: string,
    webhookUrl: string,
    attempt = 1,
  ): Promise<WebhookResponseDto> {
    const maxAttempts = 3; // 1 inicial + 2 retries
    const retryDelay = 2000; // 2s

    try {
      this.logger.log(
        `Setting webhook for instance: ${instanceName} (attempt ${attempt}/${maxAttempts})`,
      );

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/webhook/set/${instanceName}`,
          {
            webhook: {
              url: webhookUrl,
              enabled: true,
              events: [
                'QRCODE_UPDATED',
                'CONNECTION_UPDATE',
                'MESSAGES_UPSERT',
                'MESSAGES_UPDATE',
              ],
            },
          },
          {
            headers: this.getHeaders(),
            timeout: 5000,
          },
        ),
      );

      this.logger.log(`Webhook set successfully for instance: ${instanceName}`);
      return response.data;
    } catch (error) {
      this.logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed for setWebhook: ${instanceName}`,
        error.message,
      );

      if (attempt < maxAttempts) {
        this.logger.log(`Retrying in ${retryDelay}ms...`);
        await this.delay(retryDelay);
        return this.setWebhook(instanceName, webhookUrl, attempt + 1);
      }

      this.logger.error(`All attempts failed for setWebhook: ${instanceName}`);
      throw new BadGatewayException('Failed to set webhook after retries');
    }
  }

  /**
   * Utility para delay en retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
