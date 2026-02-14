import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6380/1');
    this.client = new Redis(redisUrl);
  }

  async onModuleInit() {
    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const json = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, json, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, json);
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const json = await this.client.get(key);
    if (!json) return null;
    return JSON.parse(json) as T;
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
