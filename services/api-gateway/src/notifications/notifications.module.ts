import {
  BadRequestException,
  Controller,
  forwardRef,
  Get,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  Patch,
  Post,
  Query,
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
  isWriteTimeout,
  UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN,
  getRequestHeader,
  getRequestId,
  isValidTraceparent,
  setResponseRequestId,
  type RequestContextCarrier,
} from '../common/request-context';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NotificationProxyTransportApi {
  forward(
    req: FastifyRequest,
    reply: FastifyReply,
    version: 'v1' | 'v2',
    path: string,
    query?: string,
  ): Promise<unknown> | unknown;
}

@Controller(['api/v1/notifications', 'api/notifications'])
@AuthPolicy('required')
export class NotificationProxyController {
  constructor(
    @Inject(forwardRef(() => NotificationProxyTransport))
    private readonly transport: NotificationProxyTransportApi,
  ) {}
  @Get() list(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: Record<string, string>,
  ) {
    return this.forward(request, reply, '', serializeQuery(query));
  }
  @Get('unread-count') count(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    return this.forward(req, res, '/unread-count');
  }
  @Patch(':id/read') read(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @Param('id') id: string,
  ) {
    if (!UUID_PATTERN.test(id)) throw new BadRequestException();
    return this.forward(req, res, `/${id}/read`);
  }
  @Post('read-all') readAll(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    return this.forward(req, res, '/read-all');
  }
  async forward(
    req: FastifyRequest,
    reply: FastifyReply,
    path: string,
    query = '',
  ) {
    return this.transport.forward(req, reply, 'v1', path, query);
  }
}

@Controller('api/v2/notifications')
@AuthPolicy('required')
export class NotificationV2ProxyController {
  constructor(
    @Inject(forwardRef(() => NotificationProxyTransport))
    private readonly transport: NotificationProxyTransportApi,
  ) {}

  @Get()
  list(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: Record<string, string>,
  ) {
    return this.transport.forward(
      request,
      reply,
      'v2',
      '',
      serializeQuery(query),
    );
  }

  @Get('unread-count')
  unreadCount(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: Record<string, string>,
  ) {
    return this.transport.forward(
      request,
      reply,
      'v2',
      '/unread-count',
      serializeQuery(query),
    );
  }

  @Patch(':id/read')
  markRead(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    if (!UUID_PATTERN.test(id)) throw new BadRequestException();
    return this.transport.forward(
      request,
      reply,
      'v2',
      `/${id}/read`,
      serializeQuery(query),
    );
  }

  @Post('read-all')
  readAll(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: Record<string, string>,
  ) {
    return this.transport.forward(
      request,
      reply,
      'v2',
      '/read-all',
      serializeQuery(query),
    );
  }
}

function serializeQuery(query: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string' || value.length > 512)
      throw new BadRequestException();
    params.set(key, value);
  }
  return params.toString();
}

@Injectable()
export class NotificationProxyTransport {
  private readonly logger = new Logger(NotificationProxyTransport.name);

  constructor(private readonly config: ConfigService) {}

  async forward(
    req: FastifyRequest,
    reply: FastifyReply,
    version: 'v1' | 'v2',
    path: string,
    query = '',
  ) {
    const request = req as RequestContextCarrier;
    const requestId = getRequestId(request);
    setResponseRequestId(reply, requestId);
    const authorization = getRequestHeader(req.headers, 'authorization');
    if (
      !authorization ||
      authorization.length > 8192 ||
      !/^Bearer \S+$/i.test(authorization)
    )
      throw new HttpException('Bearer token required', 401);
    const gateway = this.config.get<GatewayConfig>('gateway');
    const base =
      gateway?.upstreams?.notification ??
      this.config.get<string>('NOTIFICATION_SERVICE_URL') ??
      'http://notification-service:3000';
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization,
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };
    const traceparent = getRequestHeader(req.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) {
      headers.traceparent = traceparent;
    }

    const fail = (status: number, code: string, message: string) => {
      reply.header('Content-Type', 'application/json; charset=utf-8');
      setResponseRequestId(reply, requestId);
      return reply.code(status).send({
        error: { code, message, details: [] },
        status,
        requestId,
      });
    };
    const abortHandle = createUpstreamAbortHandle(request, reply, 10_000);
    try {
      const response = await fetch(
        `${base.replace(/\/$/, '')}/api/${version}/notifications${path}${query ? `?${query}` : ''}`,
        {
          method: req.method,
          redirect: 'error',
          signal: abortHandle.signal,
          headers,
        },
      );
      const responseHeaders = collectSafeUpstreamResponseHeaders(
        response.headers,
      );
      if (response.status === 204) {
        setResponseRequestId(reply, requestId);
        return reply.code(204).send();
      }
      if (
        response.headers.get('content-type') &&
        !response.headers.get('content-type')?.includes('application/json')
      ) {
        try {
          await response.body?.cancel();
        } catch {
          // The upstream connection is already being discarded.
        }
        return fail(502, 'BAD_GATEWAY', 'Invalid Notification response');
      }
      for (const [name, value] of Object.entries(responseHeaders)) {
        reply.header(name, value);
      }
      setResponseRequestId(reply, requestId);
      try {
        const body = (await response.json()) as unknown;
        return reply.code(response.status).send(body);
      } catch {
        return fail(502, 'BAD_GATEWAY', 'Invalid Notification response');
      }
    } catch {
      if (isWriteTimeout(abortHandle, req.method)) {
        return fail(
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.status,
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.code,
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.message,
        );
      }
      this.logger.error(`Notification upstream failed requestId=${requestId}`);
      return fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Notification service unavailable',
      );
    } finally {
      abortHandle.cleanup();
    }
  }
}
@Module({
  controllers: [NotificationProxyController, NotificationV2ProxyController],
  providers: [NotificationProxyTransport],
})
export class NotificationsModule {}
