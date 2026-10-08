import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { GatewayConfig } from '../config/gateway.config';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import type { AccessPrincipal } from '../auth/access-token.service';
import {
  applyClientForwardingHeaders,
  collectSafeUpstreamResponseHeaders,
  createUpstreamAbortHandle,
  isWriteTimeout,
  UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN,
  getRequestHeader,
  getRequestId,
  isValidTraceparent,
  setResponseRequestId,
  type RequestContextCarrier,
} from '../common/request-context';

type AuthMode = 'none' | 'optional' | 'required';

// Identity accepts 2 MiB avatars; allow multipart framing overhead on top.
const AVATAR_MAX_REQUEST_BYTES = 2 * 1024 * 1024 + 64 * 1024;
const uuidSchema = z.string().uuid();
// Mobile Google sign-in exchange: same formats Identity enforces (43-char handles, RFC 7636 verifier).
const mobileOAuthExchangeSchema = z
  .object({
    transactionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    handoffCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  })
  .strict();

function isAsyncIterable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<symbol, unknown>)[Symbol.asyncIterator] ===
      'function'
  );
}

function uuidParam(value: string): string {
  if (!uuidSchema.safeParse(value).success) {
    throw new BadRequestException('Request validation failed');
  }
  return value;
}

// Coarse edge check only; Identity re-verifies the session and ADMIN role.
function requireAdmin(req: FastifyRequest): void {
  const principal = (req as { principal?: AccessPrincipal }).principal;
  if (principal?.system_role !== 'ADMIN') {
    throw new ForbiddenException('Administrator role required');
  }
}

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
    applyClientForwardingHeaders(req, headers, req.method);

    const targetPath = this.withAllowedQuery(req, path, options.queryKeys);
    const abortHandle = createUpstreamAbortHandle(request, reply, 10_000);
    try {
      const response = await fetch(`${this.baseUrl()}${targetPath}`, {
        method: req.method,
        headers,
        body: serializedBody,
        redirect: 'error',
        signal: abortHandle.signal,
      });
      return await this.relay(response, reply, requestId, fail);
    } catch {
      if (isWriteTimeout(abortHandle, req.method)) {
        return fail(
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.status,
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.code,
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.message,
        );
      }
      this.logger.error(`Identity upstream failed requestId=${requestId}`);
      return fail(503, 'SERVICE_UNAVAILABLE', 'Identity service unavailable');
    } finally {
      abortHandle.cleanup();
    }
  }

  /**
   * Streams a multipart upload to Identity without buffering it, aborting with
   * 413 once more than maxBytes have been read. The raw stream comes from the
   * global multipart/form-data parser registered by OcrModule.
   */
  async forwardMultipart(
    req: FastifyRequest,
    reply: FastifyReply,
    path: string,
    maxBytes: number,
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

    const authorization = getRequestHeader(req.headers, 'authorization');
    if (
      !authorization ||
      authorization.length > 8192 ||
      !/^Bearer \S+$/i.test(authorization)
    ) {
      return fail(401, 'UNAUTHORIZED', 'Bearer token required');
    }
    const contentType = getRequestHeader(req.headers, 'content-type');
    if (
      !contentType ||
      contentType.length > 256 ||
      !/^multipart\/form-data;\s*boundary=\S+/i.test(contentType)
    ) {
      return fail(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'multipart/form-data required',
      );
    }
    const declaredLength = Number(
      getRequestHeader(req.headers, 'content-length'),
    );
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return fail(413, 'PAYLOAD_TOO_LARGE', 'Request too large');
    }
    const source = (
      isAsyncIterable(req.body) ? req.body : req.raw
    ) as AsyncIterable<Uint8Array>;

    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization,
      'content-type': contentType,
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };
    const traceparent = getRequestHeader(req.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) headers.traceparent = traceparent;
    const userAgent = getRequestHeader(req.headers, 'user-agent');
    if (userAgent) headers['user-agent'] = userAgent.slice(0, 512);
    applyClientForwardingHeaders(req, headers, req.method);

    let tooLarge = false;
    async function* capped(): AsyncGenerator<Uint8Array> {
      let total = 0;
      for await (const chunk of source) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          tooLarge = true;
          throw new Error('upload exceeds gateway limit');
        }
        yield chunk;
      }
    }

    const abortHandle = createUpstreamAbortHandle(request, reply, 10_000);
    try {
      const init: RequestInit & { duplex: 'half' } = {
        method: req.method,
        headers,
        body: capped() as unknown as BodyInit,
        duplex: 'half',
        redirect: 'error',
        signal: abortHandle.signal,
      };
      const response = await fetch(`${this.baseUrl()}${path}`, init);
      return await this.relay(response, reply, requestId, fail);
    } catch {
      if (tooLarge) {
        return fail(413, 'PAYLOAD_TOO_LARGE', 'Request too large');
      }
      if (isWriteTimeout(abortHandle, req.method)) {
        return fail(
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.status,
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.code,
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.message,
        );
      }
      this.logger.error(`Identity upload failed requestId=${requestId}`);
      return fail(503, 'SERVICE_UNAVAILABLE', 'Identity service unavailable');
    } finally {
      abortHandle.cleanup();
    }
  }

  private baseUrl(): string {
    const gateway = this.config.get<GatewayConfig>('gateway');
    const base =
      gateway?.upstreams?.identity ??
      this.config.get<string>('IDENTITY_SERVICE_URL') ??
      'http://identity-service:8080';
    return base.replace(/\/+$/, '');
  }

  private async relay(
    response: Response,
    reply: FastifyReply,
    requestId: string,
    fail: (status: number, code: string, message: string) => unknown,
  ) {
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

  // Only the exchange goes through the gateway: the browser legs (mobile start, callback) stay on Identity.
  @Post('oauth/mobile/exchange')
  @AuthPolicy('public')
  mobileOAuthExchange(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const parsed = mobileOAuthExchangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Request validation failed');
    }
    return this.proxy.forward(
      req,
      reply,
      '/auth/oauth/mobile/exchange',
      parsed.data,
    );
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

  // Unlink stays direct-to-Identity: it requires the browser CSRF cookie.
  @Get('me/oauth-accounts')
  oauthAccounts(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(
      req,
      reply,
      '/users/me/oauth-accounts',
      undefined,
      {
        auth: 'required',
      },
    );
  }

  @Get('me/avatar')
  avatar(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(req, reply, '/users/me/avatar', undefined, {
      auth: 'required',
    });
  }

  @Put('me/avatar')
  uploadAvatar(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forwardMultipart(
      req,
      reply,
      '/users/me/avatar',
      AVATAR_MAX_REQUEST_BYTES,
    );
  }

  @Delete('me/avatar')
  deleteAvatar(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward(req, reply, '/users/me/avatar', undefined, {
      auth: 'required',
    });
  }
}

@Controller('api/admin/users')
@AuthPolicy('required')
export class IdentityAdminProxyController {
  constructor(private readonly proxy: IdentityProxyService) {}

  @Get()
  list(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    requireAdmin(req);
    return this.proxy.forward(req, reply, '/admin/users', undefined, {
      auth: 'required',
      queryKeys: ['page', 'size', 'search', 'status'],
    });
  }

  @Get(':userId')
  get(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('userId') userId: string,
  ) {
    requireAdmin(req);
    return this.proxy.forward(
      req,
      reply,
      `/admin/users/${uuidParam(userId)}`,
      undefined,
      { auth: 'required' },
    );
  }

  @Patch(':userId/status')
  changeStatus(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    requireAdmin(req);
    return this.proxy.forward(
      req,
      reply,
      `/admin/users/${uuidParam(userId)}/status`,
      body,
      { auth: 'required' },
    );
  }
}

@Module({
  controllers: [
    IdentityAuthProxyController,
    IdentityUsersProxyController,
    IdentityAdminProxyController,
  ],
  providers: [IdentityProxyService],
})
export class IdentityModule {}
