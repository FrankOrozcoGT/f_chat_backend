import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@common/prisma/prisma.module';
import { UsersModule } from '@modules/users/users.module';
import { AuthModule } from '@modules/auth/auth.module';
import { HealthModule } from '@modules/health/health.module';
import { EvolutionModule } from '@common/evolution/evolution.module';
import { PhonesModule } from '@modules/phones/phones.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    EvolutionModule,
    UsersModule,
    AuthModule,
    HealthModule,
    PhonesModule,
  ],
})
export class AppModule {}
