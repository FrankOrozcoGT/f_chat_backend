import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6380/1');
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port, 10),
            db: parseInt(url.pathname.replace('/', '') || '0', 10),
          },
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: 'phone-webhooks' }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
