import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  CreateInstanceResponseDto,
  SendMessageResponseDto,
} from './dto/evolution-response.dto';

export enum EvolutionMediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
}

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
   * Eliminar instancia - DELETE /instance/delete/:instanceName
   * Timeout: 10s, NO retry
   */
  async deleteInstance(instanceName: string): Promise<any> {
    try {
      this.logger.log(`Deleting instance: ${instanceName}`);

      const response = await firstValueFrom(
        this.httpService.delete(
          `${this.apiUrl}/instance/delete/${instanceName}`,
          {
            headers: this.getHeaders(),
            timeout: 10000,
          },
        ),
      );

      this.logger.log(`Instance deleted successfully: ${instanceName}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to delete instance: ${instanceName}`, error.message);
      throw new BadGatewayException('Failed to delete WhatsApp instance');
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
   * Para audio, delega a sendAudioMessage que usa el endpoint específico
   * Timeout: 8s, retry x3 con exponential backoff (1s, 2s, 4s)
   */
  async sendMediaMessage(
    instanceId: string,
    phoneNumber: string,
    mediaUrl: string,
    mediatype: EvolutionMediaType,
    caption?: string,
    mimeType?: string,
    fileName?: string,
    attempt = 1,
  ): Promise<SendMessageResponseDto> {
    // Si es audio, usar endpoint específico de audio
    if (mediatype === EvolutionMediaType.AUDIO) {
      return this.sendAudioMessage(instanceId, phoneNumber, mediaUrl, attempt);
    }

    const maxAttempts = 4; // 1 inicial + 3 retries
    const baseDelay = 1000;
    const retryDelay = baseDelay * Math.pow(2, attempt - 1); // Exponential: 1s, 2s, 4s, 8s

    const payload: any = {
      number: phoneNumber,
      mediatype,
      media: mediaUrl,
    };

    if (caption) {
      payload.caption = caption;
    }

    if (mimeType) {
      payload.mimetype = mimeType;
    }

    if (fileName) {
      payload.fileName = fileName;
    }

    try {
      this.logger.log(
        `Sending media message to ${phoneNumber} via ${instanceId} (attempt ${attempt}/${maxAttempts})`,
      );

      // Log del payload completo para debugging
      this.logger.log(
        `[EVOLUTION PAYLOAD] ${JSON.stringify(payload, null, 2)}`,
      );

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/message/sendMedia/${instanceId}`,
          payload,
          {
            headers: this.getHeaders(),
            timeout: 8000,
          },
        ),
      );

      this.logger.log(`Media message sent successfully to ${phoneNumber}`);
      return response.data;
    } catch (error) {
      // Log detalles completos del error en el primer intento
      if (attempt === 1) {
        this.logger.error(
          `Evolution API rejected sendMediaMessage: ${error.message}`,
          JSON.stringify({
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            sentPayload: payload,
          }, null, 2),
        );
      }

      this.logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed for sendMediaMessage to ${phoneNumber}`,
        error.message,
      );

      if (attempt < maxAttempts) {
        this.logger.log(`Retrying in ${retryDelay}ms...`);
        await this.delay(retryDelay);
        return this.sendMediaMessage(instanceId, phoneNumber, mediaUrl, mediatype, caption, mimeType, fileName, attempt + 1);
      }

      this.logger.error(`All attempts failed for sendMediaMessage to ${phoneNumber}`);
      throw new BadGatewayException('Failed to send media message after retries');
    }
  }

  /**
   * Enviar mensaje de audio - POST /message/sendWhatsAppAudio
   * Usa endpoint específico para audio de WhatsApp
   * Timeout: 8s, retry x3 con exponential backoff (1s, 2s, 4s)
   */
  async sendAudioMessage(
    instanceId: string,
    phoneNumber: string,
    audioUrl: string,
    attempt = 1,
  ): Promise<SendMessageResponseDto> {
    const maxAttempts = 4; // 1 inicial + 3 retries
    const baseDelay = 1000;
    const retryDelay = baseDelay * Math.pow(2, attempt - 1); // Exponential: 1s, 2s, 4s, 8s

    const payload = {
      number: phoneNumber,
      audio: audioUrl,
    };

    try {
      this.logger.log(
        `Sending audio message to ${phoneNumber} via ${instanceId} (attempt ${attempt}/${maxAttempts})`,
      );

      // Log del payload completo para debugging
      this.logger.log(
        `[EVOLUTION AUDIO PAYLOAD] ${JSON.stringify(payload, null, 2)}`,
      );

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/message/sendWhatsAppAudio/${instanceId}`,
          payload,
          {
            headers: this.getHeaders(),
            timeout: 8000,
          },
        ),
      );

      this.logger.log(`Audio message sent successfully to ${phoneNumber}`);
      return response.data;
    } catch (error) {
      // Log detalles completos del error en el primer intento
      if (attempt === 1) {
        this.logger.error(
          `Evolution API rejected sendAudioMessage: ${error.message}`,
          JSON.stringify({
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            sentPayload: payload,
          }, null, 2),
        );
      }

      this.logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed for sendAudioMessage to ${phoneNumber}`,
        error.message,
      );

      if (attempt < maxAttempts) {
        this.logger.log(`Retrying in ${retryDelay}ms...`);
        await this.delay(retryDelay);
        return this.sendAudioMessage(instanceId, phoneNumber, audioUrl, attempt + 1);
      }

      this.logger.error(`All attempts failed for sendAudioMessage to ${phoneNumber}`);
      throw new BadGatewayException('Failed to send audio message after retries');
    }
  }

  /**
   * Enviar audio desde un Buffer (base64) - POST /message/sendWhatsAppAudio
   */
  async sendAudioBuffer(
    instanceId: string,
    phoneNumber: string,
    audioBuffer: Buffer,
    attempt = 1,
  ): Promise<SendMessageResponseDto> {
    const base64Audio = audioBuffer.toString('base64');
    const audioDataUrl = `data:audio/ogg;base64,${base64Audio}`;
    return this.sendAudioMessage(instanceId, phoneNumber, audioDataUrl, attempt);
  }

  /**
   * Obtener media en base64 desde Evolution API usando el message key
   * @param instanceName - Nombre de la instancia
   * @param messageKey - Key del mensaje (contiene id, remoteJid, fromMe)
   * @returns Objeto con base64, mimetype, fileName, etc.
   */
  async getBase64FromMediaMessage(
    instanceName: string,
    messageKey: { id: string; remoteJid: string; fromMe: boolean },
  ): Promise<{
    base64: string;
    mimetype: string;
    fileName: string;
    size: number;
  }> {
    try {
      this.logger.log(`Getting base64 media for message: ${messageKey.id}`);

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
          {
            message: {
              key: messageKey,
            },
            convertToMp4: false,
          },
          {
            headers: this.getHeaders(),
            timeout: 30000,
          },
        ),
      );

      // Evolution API devuelve size como objeto con fileLength, height, width
      // Extraer solo el tamaño del archivo
      const fileSize = response.data.size?.fileLength?.low || 0;

      this.logger.log(`Media retrieved successfully: ${response.data.fileName} (${fileSize} bytes)`);

      return {
        base64: response.data.base64,
        mimetype: response.data.mimetype,
        fileName: response.data.fileName,
        size: fileSize,
      };
    } catch (error) {
      this.logger.error(`Failed to get base64 from media message: ${messageKey.id}`, error.message);
      throw new BadGatewayException('Failed to download media file');
    }
  }

  /**
   * Obtener contactos de una instancia - POST /chat/findContacts/:instance
   * Timeout: 10s, NO retry
   */
  async findContacts(instanceName: string): Promise<any[]> {
    try {
      this.logger.log(`Finding contacts for instance: ${instanceName}`);

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/chat/findContacts/${instanceName}`,
          {},
          {
            headers: this.getHeaders(),
            timeout: 10000,
          },
        ),
      );

      this.logger.log(`Contacts retrieved for instance: ${instanceName}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to find contacts for instance: ${instanceName}`, error.message);
      throw new BadGatewayException('Failed to retrieve contacts from WhatsApp');
    }
  }

  /**
   * Utility para delay en retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
