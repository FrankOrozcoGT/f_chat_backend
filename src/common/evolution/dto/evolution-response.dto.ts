export class CreateInstanceResponseDto {
  instance: {
    instanceName: string;
    instanceId: string;
    status: string;
  };
}

export class QrCodeResponseDto {
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
  webhook: {
    url: string;
    enabled: boolean;
  };
}
