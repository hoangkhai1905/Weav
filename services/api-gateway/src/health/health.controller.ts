import { Controller, Get, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import { getRequestId, setResponseRequestId } from '../common/request-context';
import { GatewayHealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly health: GatewayHealthService) {}

  @Get('health')
  @AuthPolicy('public')
  @SkipThrottle({ general: true, auth: true, ocr: true })
  healthCheck(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = getRequestId(request);
    setResponseRequestId(reply, requestId);
    reply.header('Cache-Control', 'no-store');
    return { ...this.health.liveness(), requestId };
  }

  @Get('ready')
  @AuthPolicy('public')
  @SkipThrottle({ general: true, auth: true, ocr: true })
  readinessCheck(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = getRequestId(request);
    setResponseRequestId(reply, requestId);
    reply.header('Cache-Control', 'no-store');
    return { ...this.health.readiness(), requestId };
  }

  // Diagnostics only (probes upstreams); kept throttled and out of compose healthchecks.
  @Get('ready/upstreams')
  @AuthPolicy('public')
  async upstreamsCheck(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = getRequestId(request);
    setResponseRequestId(reply, requestId);
    reply.header('Cache-Control', 'no-store');
    const result = await this.health.upstreams();
    reply.code(result.status === 'ok' ? 200 : 503);
    return { ...result, requestId };
  }
}
