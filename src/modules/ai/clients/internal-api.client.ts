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

  async closeConversation(conversationId: string): Promise<void> {
    await this.request('POST', '/messages/close-conversation', { conversationId });
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

  // --- Conversations (extended) ---

  async getConversationFull(conversationId: string): Promise<{
    id: string;
    phoneId: string;
    isActive: boolean;
    summary: string | null;
    phone: { id: string; userId: string };
    client: { id: string; phoneNumber: string; name: string | null } | null;
    participants: { clientId: string }[];
  }> {
    return this.request('GET', `/conversations/${conversationId}/full`);
  }

  async updateConversationSummary(
    conversationId: string,
    summary: string,
  ): Promise<void> {
    await this.request('PATCH', `/conversations/${conversationId}/summary`, {
      summary,
    });
  }

  async createConversationWithParticipant(data: {
    phoneId: string;
    clientId: string;
    summary?: string;
    isActive: boolean;
  }): Promise<{ id: string }> {
    return this.request('POST', '/conversations/create-with-participant', data);
  }

  // --- Messages (extended) ---

  async findLastNUnanalyzed(
    conversationId: string,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      conversationId: string;
      type: string;
      content: string;
      mediaUrl: string | null;
      direction: string;
      senderType: string;
      transcription: string | null;
      createdAt: string;
    }>
  > {
    return this.request(
      'GET',
      `/messages/unanalyzed/${conversationId}?limit=${limit}`,
    );
  }

  async markAsAnalyzed(messageIds: string[]): Promise<void> {
    await this.request('POST', '/messages/mark-analyzed', { messageIds });
  }

  async moveMessagesToConversation(
    messageIds: string[],
    newConversationId?: string,
  ): Promise<void> {
    await this.request('POST', '/messages/move-to-conversation', {
      messageIds,
      ...(newConversationId && { newConversationId }),
    });
  }

  async getMessage(messageId: string): Promise<{
    id: string;
    type: string;
    content: string;
    mediaUrl: string | null;
    transcription: string | null;
  } | null> {
    return this.request('GET', `/messages/${messageId}`);
  }

  // --- Clients ---

  async updateClientName(clientId: string, name: string): Promise<void> {
    await this.request('PATCH', `/messages/clients/${clientId}/name`, { name });
  }

  // --- User Settings ---

  async getUserSettings(userId: string): Promise<{
    analysisMode: string;
    messageLimit: number;
  }> {
    return this.request('GET', `/user-settings/${userId}`);
  }

  // --- Catalog ---

  async upsertProduct(data: {
    userId: string;
    name: string;
    basePrice: number;
    description?: string;
  }): Promise<{ id: string; name: string; basePrice: number }> {
    return this.request('POST', '/catalog/products/upsert', data);
  }

  async findProduct(
    userId: string,
    name: string,
  ): Promise<{ id: string; name: string; basePrice: number } | null> {
    return this.request('POST', '/catalog/products/find', { userId, name });
  }

  async upsertDiscount(data: {
    productId: string;
    clientId?: string | null;
    discountPrice: number;
  }): Promise<{ id: string }> {
    return this.request('POST', '/catalog/discounts/upsert', data);
  }

  async createPromotion(data: {
    userId: string;
    name?: string;
    description?: string;
    specialPrice: number;
    productIds: string[];
  }): Promise<{ id: string }> {
    return this.request('POST', '/catalog/promotions/create', data);
  }

  async upsertPromotionDiscount(data: {
    promotionId: string;
    clientId?: string | null;
    discountPrice: number;
  }): Promise<{ id: string }> {
    return this.request('POST', '/catalog/promotion-discounts/upsert', data);
  }

  // --- Analysis processing ---

  async processAnalysisSplits(data: {
    conversationId: string;
    phoneId: string;
    clientId: string;
    batchMessageIds: string[];
    splits: Array<{ summary: string; messageIds: string[] }>;
    orphanMessageIds: string[];
  }): Promise<{
    createdConversations: Array<{
      id: string;
      summary: string;
      isActive: boolean;
      messageCount: number;
    }>;
  }> {
    return this.request('POST', '/messages/process-analysis-splits', data);
  }

  // --- Catalog: Nodo Identificación+Precio ---

  async loadClientProducts(
    userId: string,
    clientId: string | null,
  ): Promise<{
    products: Array<{
      id: string;
      name: string;
      basePrice: number;
      description: string | null;
      discounts: Array<{ discountPrice: number; clientId: string | null }>;
    }>;
    promotions: Array<{
      id: string;
      name: string | null;
      description: string | null;
      specialPrice: number;
      promotionProducts: Array<{ product: { name: string } }>;
    }>;
    shipping: {
      clientLocation: string | null;
      locations: Array<{
        name: string;
        isFreeShipping: boolean;
        shippingCost: number;
      }>;
      defaultShippingCost: number;
    };
  }> {
    return this.request('POST', '/catalog/load-client-products', { userId, clientId });
  }

  async searchProduct(
    userId: string,
    query: string,
  ): Promise<{
    matches: Array<{
      id: string;
      name: string;
      basePrice: number;
      description: string | null;
    }>;
  }> {
    return this.request('POST', '/catalog/search-product', { userId, query });
  }

  async checkPromotions(
    userId: string,
    clientId: string | null,
    productName: string,
  ): Promise<{
    promotions: Array<{
      id: string;
      name: string | null;
      description: string | null;
      specialPrice: number;
    }>;
  }> {
    return this.request('POST', '/catalog/check-promotions', { userId, clientId, productName });
  }

  async calculateSale(
    userId: string,
    items: Array<{ productName: string; unitPrice: number; quantity: number }>,
    location: string,
  ): Promise<{
    subtotal: number;
    shippingCost: number;
    total: number;
  }> {
    return this.request('POST', '/catalog/calculate-sale', { userId, items, location });
  }

  async saveClientLocation(
    clientId: string,
    location: string,
  ): Promise<{ clientId: string; location: string }> {
    return this.request('POST', '/catalog/save-client-location', { clientId, location });
  }

  async registerMissingProduct(
    userId: string,
    productName: string,
    clientId: string | null,
    notes: string,
  ): Promise<{ product: { id: string; name: string }; registered: boolean }> {
    return this.request('POST', '/catalog/register-missing-product', {
      userId,
      productName,
      clientId,
      notes,
    });
  }

  async processAnalysisCatalog(data: {
    userId: string;
    clientId: string | null;
    products: Array<{
      name: string;
      price: number;
      description?: string;
    }>;
    promotions: Array<{
      name: string;
      description?: string;
      specialPrice: number;
      productNames: string[];
    }>;
  }): Promise<void> {
    await this.request('POST', '/catalog/process-analysis-catalog', data);
  }

  // --- Health ---

  async markApiDown(apiName: string, message: string): Promise<void> {
    await this.request('POST', '/health/mark-down', { apiName, message });
  }
}
