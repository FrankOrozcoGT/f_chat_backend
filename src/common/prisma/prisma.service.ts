import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private configService: ConfigService) {
    const host = configService.get<string>('DB_HOST', 'localhost');
    const port = configService.get<string>('DB_PORT', '5432');
    const user = configService.get<string>('DB_USER', 'postgres');
    const password = configService.get<string>('DB_PASSWORD', '');
    const database = configService.get<string>('DB_NAME', 'fchat');
    const schema = configService.get<string>('DB_SCHEMA', 'public');

    const connectionString = `postgresql://${user}:${password}@${host}:${port}/${database}?schema=${schema}`;

    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
