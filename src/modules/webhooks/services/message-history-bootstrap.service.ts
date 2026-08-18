import { Injectable, Logger } from '@nestjs/common';
import { WebhooksService } from '../webhooks.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { ClientRepository } from '../repositories/client.repository';
import { MessageRepository } from '../repositories/message.repository';
import { GroupConversationRepository } from '../repositories/group-conversation.repository';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { EvolutionService } from '@common/evolution/evolution.service';

@Injectable()
export class MessageHistoryBootstrapService {
  private readonly logger = new Logger(MessageHistoryBootstrapService.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly websocketGateway: AppWebSocketGateway,
    private readonly clientRepository: ClientRepository,
    private readonly messageRepository: MessageRepository,
    private readonly groupConversationRepository: GroupConversationRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly evolutionService: EvolutionService,
  ) {}

  /**
   * Bootstrap de mensajes en background (fire-and-forget) para una conversación nueva
   */
  async bootstrapMessagesInBackground(
    conversationId: string,
    instanceName: string,
    remoteJid: string,
    tenantId: string,
  ) {
    try {
      const isGroupConversation = remoteJid.endsWith('@g.us');

      const [rawMessages, groupPictureUrl] = await Promise.all([
        this.evolutionService.findMessages(instanceName, remoteJid),
        isGroupConversation
          ? this.evolutionService.fetchProfilePictureUrl(instanceName, remoteJid)
          : Promise.resolve(null),
      ]);

      if (isGroupConversation && groupPictureUrl) {
        await this.groupConversationRepository.updateGroupInfo(remoteJid, { groupPictureUrl });
      }

      if (rawMessages.length === 0) return;

      // Deduplicar
      const existingKeyIds =
        await this.messageRepository.findKeyIdsByConversationId(conversationId);
      const newMessages = rawMessages
        .filter((m) => m.key?.id && !existingKeyIds.has(m.key.id))
        .sort((a, b) => (b.messageTimestamp ?? 0) - (a.messageTimestamp ?? 0));

      if (newMessages.length === 0) return;

      const ignoredTypes = ['reactionMessage', 'protocolMessage', 'pollUpdateMessage'];

      // Mapeo LID → phoneNumber → Client para grupos
      let lidToClientMap = new Map<string, { phoneNumber: string; name: string | null; profilePicUrl: string | null }>();
      if (isGroupConversation) {
        const participants = await this.evolutionService.fetchGroupParticipants(instanceName, remoteJid);
        const lidToPhone = new Map<string, string>();
        for (const p of participants) {
          if (p.phoneNumber) {
            const lid = p.id.replace('@lid', '');
            const phone = p.phoneNumber.replace('@s.whatsapp.net', '').replace('@c.us', '');
            lidToPhone.set(lid, phone);
          }
        }

        const phoneNumbers = [...new Set(lidToPhone.values())];
        if (phoneNumbers.length > 0) {
          const clients = await this.clientRepository.findManyByPhoneNumbers(phoneNumbers);
          const clientByPhone = new Map(clients.map((c) => [c.phoneNumber, c]));

          const phonesWithoutPic = phoneNumbers.filter((p) => !clientByPhone.get(p)?.profilePicUrl);
          for (const ph of phonesWithoutPic) {
            const picUrl = await this.evolutionService.fetchProfilePictureUrl(instanceName, `${ph}@s.whatsapp.net`);
            if (picUrl) {
              await this.clientRepository.updateProfilePicIfExists(ph, picUrl);
              const existing = clientByPhone.get(ph);
              if (existing) existing.profilePicUrl = picUrl;
            }
          }

          for (const [lid, phone] of lidToPhone) {
            const client = clientByPhone.get(phone);
            lidToClientMap.set(lid, {
              phoneNumber: phone,
              name: client?.name || null,
              profilePicUrl: client?.profilePicUrl || null,
            });
          }
        }
        this.logger.log(`[bootstrap] lidToClientMap: ${lidToClientMap.size} entries`);
      }

      for (const m of newMessages) {
        const rawMsg = m.message || {};
        const ignoredType = ignoredTypes.find((t) => rawMsg[t]);
        if (ignoredType) continue;

        const { type, content, hasMedia } =
          this.evolutionService.parseMessageContent(rawMsg);
        let mediaData: {
          relativePath: string;
          fileName: string;
          fileSize: number;
          mimeType: string;
        } | null = null;

        if (hasMedia && m.key?.id) {
          try {
            mediaData =
              await this.fileStorageService.downloadAndSaveMediaFromEvolution(
                this.evolutionService,
                instanceName,
                tenantId,
                conversationId,
                m.key.id,
                m.key,
              );
            this.websocketGateway.emit(
              'message:media_ready',
              {
                id: m.key.id,
                conversationId,
                mediaUrl: mediaData.relativePath,
              },
              tenantId,
            );
          } catch (err) {
            this.logger.warn(
              `Failed to download media for keyId ${m.key.id}: ${err.message}`,
            );
          }
        }

        await this.messageRepository.create({
          conversationId,
          type,
          content,
          mediaUrl: mediaData?.relativePath || null,
          fileName: mediaData?.fileName || null,
          fileSize: mediaData?.fileSize || null,
          mimeType: mediaData?.mimeType || null,
          direction: m.key?.fromMe ? 'outgoing' : 'incoming',
          senderType: m.key?.fromMe ? 'agent' : 'client',
          status: 'delivered',
          metadata: (() => {
            const meta: Record<string, string> = { keyId: m.key?.id ?? "" };
            if (isGroupConversation && !m.key?.fromMe && m.pushName) {
              const clientInfo = lidToClientMap.get(m.pushName);
              if (clientInfo) {
                meta.senderJid = `${clientInfo.phoneNumber}@s.whatsapp.net`;
                meta.senderName = clientInfo.name || clientInfo.phoneNumber;
                if (clientInfo.profilePicUrl) meta.senderProfilePicUrl = clientInfo.profilePicUrl;
              } else {
                meta.senderName = m.pushName;
              }
            } else if (m.pushName) {
              meta.senderName = m.pushName;
            }
            const quotedStanzaId = this.webhooksService.extractQuotedStanzaId(
              m.message || {},
            );
            if (quotedStanzaId) meta.quotedMessageId = quotedStanzaId;
            return meta;
          })(),
          createdAt: m.messageTimestamp
            ? new Date(m.messageTimestamp * 1000)
            : undefined,
        });
      }

      this.logger.log(
        `Background: bootstrapped conversation ${conversationId} with ${newMessages.length} messages`,
      );
    } catch (err) {
      this.logger.error(`Background bootstrap failed for ${conversationId} (remoteJid=${remoteJid}): ${err.message}`, err.stack);
      throw err;
    }
  }
}
