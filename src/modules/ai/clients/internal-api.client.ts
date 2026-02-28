import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalApiClient {
  private readonly logger = new Logger(InternalApiClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    const port = this.configService.get<number>('PORT', 3001);
    this.baseUrl = `http://127.0.0.1:${port}/internal`;
    this.apiKey = this.configService.get<string>('INTERNAL_API_KEY', '');
    if (!this.apiKey) {
      throw new Error('INTERNAL_API_KEY is not configured');
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': this.apiKey,
      },
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Internal API ${method} ${path} failed (${response.status}): ${text}`,
      );
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json() as Promise<T>;
    }
    return undefined as T;
  }

  // --- Conversations ---

  async getConversation(
    conversationId: string,
  ): Promise<{ id: string; phone: { userId: string } }> {
    return this.request('GET', `/conversations/${conversationId}`);
  }

  async updateConversationMode(
    conversationId: string,
    mode: string,
  ): Promise<void> {
    await this.request('PATCH', `/conversations/${conversationId}/mode`, {
      mode,
    });
  }

  // --- Users ---

  async getUser(
    userId: string,
  ): Promise<{
    id: string;
    creditsUsed: number;
    creditsLimit: number;
  }> {
    return this.request('GET', `/users/${userId}`);
  }

  async incrementCreditsUsed(
    userId: string,
    credits: number,
  ): Promise<void> {
    await this.request('PATCH', `/users/${userId}/credits`, { credits });
  }

  // --- Messages ---

  async sendMessageTransaction(
    conversationId: string,
    userId: string,
    messageData: Record<string, unknown>,
    conversationUpdate: { lastMessageAt: Date; lastMessagePreview: string },
  ): Promise<{ message: { id: string } }> {
    return this.request('POST', '/messages/send-transaction', {
      conversationId,
      userId,
      messageData,
      conversationUpdate,
    });
  }

  async updateTranscription(
    messageId: string,
    transcription: string,
  ): Promise<void> {
    await this.request('PATCH', `/messages/${messageId}/transcription`, {
      transcription,
    });
  }

  async getMessageHistory(
    conversationId: string,
    take = 31,
  ): Promise<{ content: string; direction: string }[]> {
    return this.request(
      'GET',
      `/messages/history/${conversationId}?take=${take}`,
    );
  }

  // --- Health ---

  async markApiDown(apiName: string, message: string): Promise<void> {
    await this.request('POST', '/health/mark-down', { apiName, message });
  }
}
