export class MessageKeyDto {
  id: string;
  fromMe: boolean;
  remoteJid: string;
  participant?: string;
  remoteJidAlt?: string;
  addressingMode?: string;
}

export class MessageUpdateDto {
  status: string;
}

export class MessageResponseDto {
  id: string;
  key: MessageKeyDto;
  pushName: string;
  messageType: string;
  message: Record<string, any>;
  messageTimestamp: number;
  instanceId: string;
  source: string;
  contextInfo: Record<string, any>;
  MessageUpdate: MessageUpdateDto[];
}
