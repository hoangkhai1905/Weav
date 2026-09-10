import { Body, Controller, Get, Module, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Controller('api/auth')
export class IdentityProxyController {
  constructor(private readonly config: ConfigService) {}

  @Post('login')
  login(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.forward(req, reply, '/auth/login', body);
  }

  @Post('register')
  register(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.forward(req, reply, '/auth/register', body);
  }

  @Post('refresh')
  refresh(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.forward(req, reply, '/auth/refresh', body);
  }

  @Post('logout')
  logout(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.forward(req, reply, '/auth/logout', body);
  }

  @Get('me')
  me(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.forward(req, reply, '/users/me');
  }

  private async forward(
    req: FastifyRequest,
    reply: FastifyReply,
    path: string,
    body?: unknown,
  ) {
    reply.header('Cache-Control', 'no-store');
    const fail = (status: number, code: string, message: string) =>
      reply.code(status).send({
        error: { code, message, details: [] },
        status,
      });
    const headers: Record<string, string> = { accept: 'application/json' };
    if (path === '/users/me') {
      const authorization = req.headers.authorization;
      if (
        !authorization ||
        authorization.length > 8192 ||
        !/^Bearer \S+$/i.test(authorization)
      ) {
        return fail(401, 'UNAUTHORIZED', 'Bearer token required');
      }
      headers.authorization = authorization;
    }
    let serializedBody: string | undefined;
    if (req.method === 'POST') {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return fail(400, 'BAD_REQUEST', 'JSON object required');
      }
      serializedBody = JSON.stringify(body);
      if (Buffer.byteLength(serializedBody, 'utf8') > 16384) {
        return fail(413, 'PAYLOAD_TOO_LARGE', 'Request too large');
      }
      headers['content-type'] = 'application/json';
    }
    const userAgent = req.headers['user-agent'];
    if (userAgent) headers['user-agent'] = userAgent.slice(0, 512);
    const base =
      this.config.get<string>('IDENTITY_SERVICE_URL') ??
      'http://identity-service:8080';
    try {
      const response = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
        method: req.method,
        headers,
        body: serializedBody,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter && /^\d{1,6}$/.test(retryAfter))
        reply.header('Retry-After', retryAfter);
      if (response.status === 204) return reply.code(204).send();
      if (!response.headers.get('content-type')?.includes('application/json')) {
        return fail(502, 'BAD_GATEWAY', 'Invalid Identity response');
      }
      return reply.code(response.status).send(await response.json());
    } catch {
      return fail(503, 'SERVICE_UNAVAILABLE', 'Identity service unavailable');
    }
  }
}

@Module({ controllers: [IdentityProxyController] })
export class IdentityModule {}
