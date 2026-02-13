import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AiService } from './ai.service';
import { AiRepository } from './repositories/ai.repository';
import { ConversationRepository } from '@modules/conversations/repositories/conversation.repository';
import { MessageSendService } from '@modules/messages/message-send.service';
import { FileStorageService } from '@common/file-storage/file-storage.service';
import { MessageType } from '@prisma/client';

export interface IncomingAudioEvent {
  messageId: string;
  conversationId: string;
  instanceName: string;
  clientPhone: string;
  userId: string;
  mediaRelativePath: string;
}

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly aiRepository: AiRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly messageSendService: MessageSendService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  @OnEvent('ai.incoming.audio')
  async handleIncomingAudio(payload: IncomingAudioEvent): Promise<void> {
    const { messageId, conversationId, instanceName, clientPhone, userId, mediaRelativePath } = payload;

    try {
      // 1. Leer audio entrante del disco
      const audioBuffer = await this.fileStorageService.readFile(mediaRelativePath);

      // 2. Pipeline AI: STT → LLM → TTS
      const aiResult = await this.aiService.processAudioMessage(
        audioBuffer,
        messageId,
        conversationId,
        clientPhone,
      );

      // 3. Guardar API calls en BD
      await this.aiRepository.saveApiCalls(aiResult.apiCalls);

      // 4. Generar ID para el mensaje de respuesta
      const { randomUUID } = await import('crypto');
      const responseMessageId = randomUUID();

      // 5. Guardar audio de respuesta en disco
      const savedFile = await this.fileStorageService.saveBuffer(
        aiResult.audioBuffer,
        userId,
        conversationId,
        responseMessageId,
        '.ogg',
        'audio/ogg',
      );

      // 6. Construir URL accesible para Evolution API
      const mediaUrlForEvolution = this.fileStorageService.buildDockerAccessibleUrl(savedFile.relativePath);

      // 7. Enviar usando el mismo flujo que HITL (MessageSendService)
      const message = await this.messageSendService.send({
        conversationId,
        userId,
        instanceId: instanceName,
        clientPhone,
        tipo: MessageType.voice,
        contenido: aiResult.responseText,
        relativePath: savedFile.relativePath,
        mediaUrlForEvolution,
        messageId: responseMessageId,
        mimeType: savedFile.mimeType,
        fileName: savedFile.fileName,
        fileSize: savedFile.fileSize,
        senderType: 'system',
      });

      // 8. Guardar costo AI en el mensaje
      await this.aiRepository.saveMessage(message.id, aiResult.totalCost);

      this.logger.log(`AI response sent for conversation ${conversationId} | Cost: $${aiResult.totalCost.toFixed(6)}`);

      // 9. Si intent es switch_hitl, cambiar modo
      if (aiResult.intent === 'switch_hitl') {
        await this.conversationRepository.updateMode(conversationId, 'HITL');
        this.logger.log(`Conversation ${conversationId} switched to HITL mode`);
      }
    } catch (error) {
      this.logger.error(`AI processing failed for conversation ${conversationId}: ${error.message}`);
    }
  }
}
