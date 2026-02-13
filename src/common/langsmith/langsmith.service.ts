import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { traceable } from 'langsmith/traceable';

@Injectable()
export class LangSmithService {
  private readonly logger = new Logger(LangSmithService.name);
  private readonly isEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('LANGSMITH_API_KEY', '');
    const project = this.configService.get<string>('LANGSMITH_PROJECT', '');

    this.isEnabled = !!apiKey && !!project;

    if (this.isEnabled) {
      // LangSmith SDK reads these env vars automatically
      process.env.LANGSMITH_TRACING = 'true';
      process.env.LANGSMITH_ENDPOINT = 'https://api.smith.langchain.com';
      process.env.LANGSMITH_API_KEY = apiKey;
      process.env.LANGSMITH_PROJECT = project;
      this.logger.log(`LangSmith tracing enabled for project: ${project}`);
    } else {
      this.logger.warn('LangSmith not configured (missing LANGSMITH_API_KEY or LANGSMITH_PROJECT)');
    }
  }

  /**
   * Wraps the STT step as a traceable function
   */
  traceSTT<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isEnabled) return fn();
    const traced = traceable(fn, { name: 'stt', run_type: 'tool' });
    return traced();
  }

  /**
   * Wraps the LLM step as a traceable function
   */
  traceLLM<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isEnabled) return fn();
    const traced = traceable(fn, { name: 'llm', run_type: 'llm' });
    return traced();
  }

  /**
   * Wraps the TTS step as a traceable function
   */
  traceTTS<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isEnabled) return fn();
    const traced = traceable(fn, { name: 'tts', run_type: 'tool' });
    return traced();
  }

  /**
   * Wraps the full AI pipeline as a traceable function
   */
  tracePipeline<T>(fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
    if (!this.isEnabled) return fn();
    const traced = traceable(fn, {
      name: 'ai-voice-pipeline',
      run_type: 'chain',
      metadata,
    });
    return traced();
  }
}
