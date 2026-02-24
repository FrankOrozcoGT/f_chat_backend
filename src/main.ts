import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { AppModule } from '@/app.module';

// Cargar .env ANTES de inicializar NestJS
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: console,
    bufferLogs: true,
  });
  const configService = app.get(ConfigService);

  // Body parser limit (Evolution webhooks pueden ser grandes durante sync)
  app.use(express.json({ limit: '10mb' }));

  // Cookie Parser
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN') || 'http://localhost:5173',
    credentials: true,
  });

  // Servir archivos estáticos desde /storage
  app.useStaticAssets(join(process.cwd(), 'storage'), {
    prefix: '/storage/',
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
}
bootstrap();
