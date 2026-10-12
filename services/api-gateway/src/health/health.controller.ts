import { Controller, ForbiddenException, Get, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AccessPrincipal } from '../auth/access-token.service';
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

  // Diagnostics only (probes upstreams); kept throttled and out of compose
  // healthchecks. Requires a valid access token with the ADMIN system role.
  @Get('ready/upstreams')
  @AuthPolicy('required')
  async upstreamsCheck(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = getRequestId(request);
    setResponseRequestId(reply, requestId);
    reply.header('Cache-Control', 'no-store');
    const principal = (request as { principal?: AccessPrincipal }).principal;
    if (principal?.system_role !== 'ADMIN') {
      throw new ForbiddenException('Administrator role required');
    }
    const result = await this.health.upstreams();
    reply.code(result.status === 'ok' ? 200 : 503);
    return { ...result, requestId };
  }
}
