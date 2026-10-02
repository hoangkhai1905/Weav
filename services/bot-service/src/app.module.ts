import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DenyAllGuard } from './deny-all.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [],
  controllers: [AppController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: DenyAllGuard }],
})
export class AppModule {}
