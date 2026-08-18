import { Injectable, Logger } from '@nestjs/common';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { ClientRepository } from '../repositories/client.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import type { EvolutionWebhookEvent, EvolutionContactUpsert } from '../types/evolution-webhook.types';

@Injectable()
export class ContactSyncService {
  private readonly logger = new Logger(ContactSyncService.name);

  // Debounce timers para sync de contactos por phoneId
  private readonly syncDebounceTimers = new Map<string, NodeJS.Timeout>();
  // Contador acumulado de contactos por phoneId
  private readonly syncContactsCount = new Map<string, number>();

  constructor(
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly clientRepository: ClientRepository,
    private readonly conversationRepository: ConversationRepository,
  ) {}

  /**
   * Procesa contacts.upsert — sync inicial de contactos en bulk
   */
  async syncContacts(
    phoneId: string,
    tenantId: string,
    webhookData: EvolutionWebhookEvent<EvolutionContactUpsert[]>,
  ) {
    const raw: EvolutionContactUpsert[] =
      Array.isArray(webhookData?.data) ? webhookData.data : [];

    const contacts = raw.filter((c) =>
      c.remoteJid?.endsWith('@s.whatsapp.net'),
    );

    this.logger.log(
      `[${new Date().toISOString()}] contacts.upsert phone=${phoneId} total=${raw.length} individual=${contacts.length}`,
    );

    // Resetear debounce
    const existingTimer = this.syncDebounceTimers.get(phoneId);
    if (existingTimer) clearTimeout(existingTimer);

    const resetTimer = setTimeout(() => {
      const finalCount = this.syncContactsCount.get(phoneId) ?? 0;
      this.syncDebounceTimers.delete(phoneId);
      this.syncContactsCount.delete(phoneId);
      this.websocketGateway.emit(
        'phone:sync_complete',
        { phoneId, contactsCount: finalCount },
        tenantId,
      );
      this.logger.log(
        `[${new Date().toISOString()}] phone:sync_complete phone=${phoneId} contactsCount=${finalCount}`,
      );
    }, 5000);

    this.syncDebounceTimers.set(phoneId, resetTimer);

    if (contacts.length === 0) return;

    // 1. Bulk insert clientes
    await this.clientRepository.createManySkipDuplicates(
      contacts.map((c) => ({
        phoneNumber: c.remoteJid!.replace('@s.whatsapp.net', ''),
        name: c.pushName || c.remoteJid!.replace('@s.whatsapp.net', ''),
        profilePicUrl: c.profilePicUrl || null,
      })),
    );

    // 2. Obtener IDs y bulk insert conversaciones
    const phoneNumbers = contacts.map((c) =>
      c.remoteJid!.replace('@s.whatsapp.net', ''),
    );
    const clients =
      await this.clientRepository.findManyByPhoneNumbers(phoneNumbers);
    const phoneToClientId = new Map(clients.map((c) => [c.phoneNumber, c.id]));

    const conversationsData = contacts
      .map((c) => {
        const phoneNumber = c.remoteJid!.replace('@s.whatsapp.net', '');
        const clientId = phoneToClientId.get(phoneNumber);
        return clientId ? { phoneId, clientId } : null;
      })
      .filter((d): d is { phoneId: string; clientId: string } => d !== null);

    await this.conversationRepository.createManyIndividualWithParticipants(
      conversationsData,
    );

    // 2b. Bulk insert ConversationParticipants
    const conversations = await this.conversationRepository.findManyIndividualByPhoneAndClientIds(
      phoneId,
      conversationsData.map((d) => d.clientId),
    );
    await this.conversationRepository.createManyParticipantsSkipDuplicates(
      conversations
        .filter((c) => c.participants[0]?.clientId)
        .map((c) => ({ conversationId: c.id, clientId: c.participants[0].clientId })),
    );

    // 3. Acumular contador y emitir progreso
    const prev = this.syncContactsCount.get(phoneId) ?? 0;
    const total = prev + contacts.length;
    this.syncContactsCount.set(phoneId, total);

    this.websocketGateway.emit(
      'phone:sync_progress',
      { phoneId, contactsCount: total },
      tenantId,
    );

    this.logger.log(
      `[${new Date().toISOString()}] phone:sync_progress phone=${phoneId} contactsCount=${total}`,
    );
  }
}
