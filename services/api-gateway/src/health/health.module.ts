import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { GatewayHealthService } from './health.service';

@Module({
  imports: [ConfigModule, TerminusModule.forRoot()],
  controllers: [HealthController],
  providers: [GatewayHealthService],
})
export class HealthModule {}
