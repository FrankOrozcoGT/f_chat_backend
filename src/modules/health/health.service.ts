import { Injectable } from '@nestjs/common';
import { ApiName } from '@prisma/client';

export interface ApiFailureData {
  apiName: ApiName;
  step: string;
  errorMessage: string;
  timestamp: string;
}

@Injectable()
export class HealthService {
  buildAPIFailureData(apiName: ApiName, step: string, error: Error): ApiFailureData {
    return {
      apiName,
      step,
      errorMessage: error.message,
      timestamp: new Date().toISOString(),
    };
  }

  buildClientErrorMessage(apiName: ApiName): string {
    const names: Record<ApiName, string> = {
      qwen_stt: 'transcripción de voz',
      kimi_llm: 'asistente de texto',
      qwen_tts: 'síntesis de voz',
    };

    return `Lo sentimos, el servicio de ${names[apiName]} no está disponible en este momento. Un agente te atenderá en breve.`;
  }
}
