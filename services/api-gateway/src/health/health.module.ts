import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { GatewayHealthService } from './health.service';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [GatewayHealthService],
})
export class HealthModule {}
