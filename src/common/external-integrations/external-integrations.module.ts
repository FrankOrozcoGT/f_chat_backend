import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmClient } from './llm.client';
import { QwenSttClient } from './qwen-stt.client';
import { QwenTtsClient } from './qwen-tts.client';
import { InternalApiClient } from './internal-api.client';

@Module({
  imports: [ConfigModule],
  providers: [LlmClient, QwenSttClient, QwenTtsClient, InternalApiClient],
  exports: [LlmClient, QwenSttClient, QwenTtsClient, InternalApiClient],
})
export class ExternalIntegrationsModule {}
