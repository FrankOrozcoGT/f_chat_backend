export class CreateInstanceResponseDto {
  instance: {
    instanceName: string;
    instanceId: string;
    status: string;
  };
  qrcode?: {
    code?: string;
    base64?: string;
  };
}

export class ConnectInstanceResponseDto {
  code?: string;
  base64?: string;
  pairingCode?: string | null;
  count?: number;
}

export class SendMessageResponseDto {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  message: {
    conversation?: string;
    extendedTextMessage?: {
      text: string;
    };
  };
  messageTimestamp: string;
  status: string;
}
