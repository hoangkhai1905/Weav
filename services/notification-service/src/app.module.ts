import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { loadSettings, SETTINGS } from './config/settings';
import { DeliveryRepository } from './domain/notification';
import { Notifications } from './application/notifications';
import { DeliveryWorker, PROVIDERS } from './application/delivery.worker';
import { PrismaDeliveryRepository } from './infrastructure/prisma.repository';
import { RabbitConsumer } from './infrastructure/rabbit.consumer';
import { ExpoProvider, TelegramProvider } from './infrastructure/providers';
import {
  AccessGuard,
  ApiErrorFilter,
  HealthController,
  NotificationsController,
} from './presentation/http';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [NotificationsController, HealthController],
  providers: [
    { provide: SETTINGS, useFactory: () => loadSettings() },
    { provide: DeliveryRepository, useClass: PrismaDeliveryRepository },
    Notifications,
    AccessGuard,
    RabbitConsumer,
    TelegramProvider,
    ExpoProvider,
    DeliveryWorker,
    {
      provide: PROVIDERS,
      inject: [TelegramProvider, ExpoProvider],
      useFactory: (telegram: TelegramProvider, expo: ExpoProvider) => ({
        TELEGRAM: telegram,
        EXPO_PUSH: expo,
      }),
    },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
