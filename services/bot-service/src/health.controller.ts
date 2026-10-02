import { Controller, Get } from '@nestjs/common';
import { Public } from './deny-all.guard';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}
