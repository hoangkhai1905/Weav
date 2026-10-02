import { Controller, Get, HttpException, Inject } from '@nestjs/common';
import { AI_DEPS } from '../../ai-deps';
import type { AiDeps } from '../../ai-deps';

@Controller('health')
export class HealthController {
  constructor(@Inject(AI_DEPS) private readonly deps: AiDeps) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  ready() {
    if (!this.deps.provider || !this.deps.verifier)
      throw new HttpException({ status: 'not_ready' }, 503);
    return { status: 'ready' };
  }
}
