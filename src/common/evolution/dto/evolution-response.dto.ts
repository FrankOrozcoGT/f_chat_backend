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

export class QrCodeResponseDto {
  count?: number;
  pairingCode?: string;
  code?: string;
  base64?: string;
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

export class WebhookResponseDto {
  url: string;
  enabled: boolean;
  events: string[];
  webhookByEvents?: boolean;
  webhookBase64?: boolean;
}
