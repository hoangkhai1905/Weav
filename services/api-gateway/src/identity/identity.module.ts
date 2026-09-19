import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayConfig } from '../config/gateway.config';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import {
  collectSafeUpstreamResponseHeaders,
  createUpstreamAbortHandle,
  getRequestHeader,
  getRequestId,
  isValidTraceparent,
  setResponseRequestId,
  type RequestContextCarrier,
} from '../common/request-context';

type AuthMode = 'none' | 'optional' | 'required';

interface ForwardOptions {
  auth?: AuthMode;
  queryKeys?: readonly string[];
}

@Injectable()
export class IdentityProxyService {
  private readonly logger = new Logger(IdentityProxyService.name);

  constructor(private readonly config: ConfigService) {}

  async forward(
    req: FastifyRequest,
    reply: FastifyReply,
    path: string,
    body?: unknown,
    options: ForwardOptions = {},
  ) {
    const request = req as RequestContextCarrier;
    const requestId = getRequestId(request);
    setResponseRequestId(reply, requestId);
    reply.header('Cache-Control', 'no-store');
    const fail = (status: number, code: string, message: string) => {
      reply.header('Content-Type', 'application/json; charset=utf-8');
      setResponseRequestId(reply, requestId);
      reply.header('Cache-Control', 'no-store');
      return reply.code(status).send({
        error: { code, message, details: [] },
        status,
        requestId,
      });
    };

    const authMode = options.auth ?? 'none';
    const authorization = getRequestHeader(req.headers, 'authorization');
    if (authorization) {
      if (authorization.length > 8192 || !/^Bearer \S+$/i.test(authorization)) {
        return fail(401, 'UNAUTHORIZED', 'Bearer token required');
      }
    } else if (authMode === 'required') {
      return fail(401, 'UNAUTHORIZED', 'Bearer token required');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };
    if (authorization) headers.authorization = authorization;

    const traceparent = getRequestHeader(req.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) {
      headers.traceparent = traceparent;
    }

    let serializedBody: string | undefined;
    if (req.method === 'POST' || req.method === 'PATCH') {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return fail(400, 'BAD_REQUEST', 'JSON object required');
      }
      serializedBody = JSON.stringify(body);
      if (Buffer.byteLength(serializedBody, 'utf8') > 16384) {
        return fail(413, 'PAYLOAD_TOO_LARGE', 'Request too large');
      }
      headers['content-type'] = 'application/json';
    }

    const userAgent = getRequestHeader(req.headers, 'user-agent');
    if (userAgent) headers['user-agent'] = userAgent.slice(0, 512);

    const targetPath = this.withAllowedQuery(req, path, options.queryKeys);
    const gateway = this.config.get<GatewayConfig>('gateway');
    const base =
      gateway?.upstreams?.identity ??
      this.config.get<string>('IDENTITY_SERVICE_URL') ??
      'http://identity-service:8080';

    const abortHandle = createUpstreamAbortHandle(request, reply, 10_000);
    try {
      const response = await fetch(`${base.replace(/\/+$/, '')}${targetPath}`, {
        method: req.method,
        headers,
        body: serializedBody,
        redirect: 'error',
        signal: abortHandle.signal,
      });
      const responseHeaders = collectSafeUpstreamResponseHeaders(
        response.headers,
      );
      if (response.status === 204) {
        setResponseRequestId(reply, requestId);
        reply.header('Cache-Control', 'no-store');
        return reply.code(204).send();
      }
      if (
        !responseHeaders['content-type']
          ?.toLowerCase()
          .includes('application/json')
      ) {
        try {
          await response.body?.cancel();
        } catch {
          // The upstream connection is already being discarded.
        }
        return fail(502, 'BAD_GATEWAY', 'Invalid Identity response');
      }
      for (const [name, value] of Object.entries(responseHeaders)) {
        if (name !== 'cache-control') {
          reply.header(name, value);
        }
      }
      setResponseRequestId(reply, requestId);
      reply.header('Cache-Control', 'no-store');
      try {
        return reply.code(response.status).send(await response.json());
      } catch {
        return fail(502, 'BAD_GATEWAY', 'Invalid Identity response');
      }
    } catch {
      this.logger.error(`Identity upstream failed requestId=${requestId}`);
      return fail(503, 'SERVICE_UNAVAILABLE', 'Identity service unavailable');
    } finally {
      abortHandle.cleanup();
    }
  }

  private withAllowedQuery(
    req: FastifyRequest,
    path: string,
    queryKeys?: readonly string[],
  ): string {
    if (!queryKeys?.length || !req.query || typeof req.query !== 'object')
      return path;

    const query = req.query as Record<string, unknown>;
    const search = new URLSearchParams();
    for (const key of queryKeys) {
      const value = query[key];
      if (typeof value === 'string' && value.length <= 64) {
        search.set(key, value);
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        search.set(key, String(value));
      }
    }
    const encoded = search.toString();
    return encoded ? `${path}?${encoded}` : path;
  }
}

@Controller('api/auth')
@AuthPolicy('required')
export class IdentityAuthProxyController {
  constructor(private readonly proxy: IdentityProxyService) {}

  @Post('login')
  @AuthPolicy('public')
  login(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/login', body);
  }

  @Post('register')
  @AuthPolicy('public')
  register(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/register', body);
  }

  @Post('refresh')
  @AuthPolicy('public')
  refresh(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/refresh', body);
  }

  @Post('logout')
  @AuthPolicy('public')
  logout(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/logout', body);
  }

  @Get('me')
  me(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(req, reply, '/users/me', undefined, {
      auth: 'required',
    });
  }

  @Patch('me')
  updateMe(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/users/me', body, {
      auth: 'required',
    });
  }

  @Post('change-password')
  changePassword(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/change-password', body, {
      auth: 'required',
    });
  }

  @Post('otp/request')
  @AuthPolicy('optional')
  requestOtp(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/otp/request', body, {
      auth: 'optional',
    });
  }

  @Post('otp/verify')
  @AuthPolicy('optional')
  verifyOtp(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/otp/verify', body, {
      auth: 'optional',
    });
  }

  @Post('forgot-password')
  @AuthPolicy('public')
  forgotPassword(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/forgot-password', body);
  }

  @Post('reset-password')
  @AuthPolicy('public')
  resetPassword(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/auth/reset-password', body);
  }

  @Get('sessions')
  sessions(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(req, reply, '/users/me/sessions', undefined, {
      auth: 'required',
      queryKeys: ['page', 'size'],
    });
  }

  @Delete('sessions')
  revokeAllSessions(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(req, reply, '/users/me/sessions', undefined, {
      auth: 'required',
    });
  }

  @Delete('sessions/:sessionId')
  revokeSession(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('sessionId') sessionId: string,
  ) {
    return this.proxy.forward(
      req,
      reply,
      `/users/me/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      { auth: 'required' },
    );
  }
}

@Controller('api/users')
@AuthPolicy('required')
export class IdentityUsersProxyController {
  constructor(private readonly proxy: IdentityProxyService) {}

  @Get('me')
  me(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(req, reply, '/users/me', undefined, {
      auth: 'required',
    });
  }

  @Patch('me')
  updateMe(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(req, reply, '/users/me', body, {
      auth: 'required',
    });
  }

  @Get('me/sessions')
  sessions(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(req, reply, '/users/me/sessions', undefined, {
      auth: 'required',
      queryKeys: ['page', 'size'],
    });
  }

  @Delete('me/sessions')
  revokeAllSessions(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(req, reply, '/users/me/sessions', undefined, {
      auth: 'required',
    });
  }

  @Delete('me/sessions/:sessionId')
  revokeSession(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('sessionId') sessionId: string,
  ) {
    return this.proxy.forward(
      req,
      reply,
      `/users/me/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      { auth: 'required' },
    );
  }
}

@Module({
  controllers: [IdentityAuthProxyController, IdentityUsersProxyController],
  providers: [IdentityProxyService],
})
export class IdentityModule {}
