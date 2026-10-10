import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { loadSettings, SETTINGS } from './config/settings';
import { DeliveryRepository } from './domain/notification';
import { InboxRepository } from './domain/inbox';
import { Notifications } from './application/notifications';
import { InboxNotifications } from './application/inbox-notifications';
import { DeliveryWorker, PROVIDERS } from './application/delivery.worker';
import { PrismaDeliveryRepository } from './infrastructure/prisma.repository';
import { PrismaInboxRepository } from './infrastructure/prisma.inbox.repository';
import { RabbitConsumer } from './infrastructure/rabbit.consumer';
import {
  EmailProvider,
  ExpoProvider,
  TelegramProvider,
} from './infrastructure/providers';
import {
  AccessGuard,
  ApiErrorFilter,
  HealthController,
  InboxNotificationsController,
  NotificationsController,
} from './presentation/http';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    NotificationsController,
    InboxNotificationsController,
    HealthController,
  ],
  providers: [
    { provide: SETTINGS, useFactory: () => loadSettings() },
    { provide: DeliveryRepository, useClass: PrismaDeliveryRepository },
    { provide: InboxRepository, useClass: PrismaInboxRepository },
    Notifications,
    InboxNotifications,
    AccessGuard,
    RabbitConsumer,
    TelegramProvider,
    ExpoProvider,
    EmailProvider,
    DeliveryWorker,
    {
      provide: PROVIDERS,
      inject: [TelegramProvider, ExpoProvider, EmailProvider],
      useFactory: (
        telegram: TelegramProvider,
        expo: ExpoProvider,
        email: EmailProvider,
      ) => ({
        TELEGRAM: telegram,
        EXPO_PUSH: expo,
        EMAIL: email,
      }),
    },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
