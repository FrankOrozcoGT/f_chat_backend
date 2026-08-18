import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KimiClient } from './kimi.client';
import { QwenSttClient } from './qwen-stt.client';
import { QwenTtsClient } from './qwen-tts.client';
import { InternalApiClient } from './internal-api.client';

@Module({
  imports: [ConfigModule],
  providers: [KimiClient, QwenSttClient, QwenTtsClient, InternalApiClient],
  exports: [KimiClient, QwenSttClient, QwenTtsClient, InternalApiClient],
})
export class ExternalIntegrationsModule {}
