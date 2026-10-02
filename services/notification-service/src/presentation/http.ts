import {
  ArgumentsHost,
  BadRequestException,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Notifications } from '../application/notifications';
import { InboxNotifications } from '../application/inbox-notifications';
import {
  DeliveryRepository,
  eventTypeSchema,
  statusSchema,
} from '../domain/notification';
import { InboxRepository } from '../domain/inbox';
import type { InboxQuery } from '../domain/inbox';
import type { NotificationLocale } from '../domain/notification-catalog';
import { RabbitConsumer } from '../infrastructure/rabbit.consumer';
import { SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';

const claimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  jti: z.uuid(),
  token_use: z.literal('access'),
  user_status: z.literal('ACTIVE'),
  system_role: z.enum(['USER', 'ADMIN']),
  exp: z.number().int(),
  iat: z.number().int(),
  nbf: z.number().int(),
});
type Request = FastifyRequest & { userId: string };
@Injectable()
export class AccessGuard implements CanActivate {
  // Created once; jose fetches lazily, so a down identity only fails RS256 tokens.
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  constructor(@Inject(SETTINGS) private readonly settings: Settings) {
    this.jwks = createRemoteJWKSet(new URL(settings.JWT_JWKS_URI));
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    try {
      const authorization = request.headers.authorization;
      if (
        !authorization ||
        authorization.length > 8192 ||
        !/^Bearer \S+$/i.test(authorization)
      )
        throw new Error();
      const token = authorization.slice(7);
      const options = {
        issuer: this.settings.JWT_ISSUER,
        audience: this.settings.JWT_AUDIENCE,
        clockTolerance: 30,
      };
      // Pick the key by the header alg; each key only ever verifies its own algorithm.
      const { alg } = decodeProtectedHeader(token);
      let payload: JWTPayload;
      if (alg === 'HS256')
        ({ payload } = await jwtVerify(
          token,
          new TextEncoder().encode(this.settings.JWT_ACCESS_SECRET),
          { ...options, algorithms: ['HS256'] },
        ));
      else if (alg === 'RS256')
        ({ payload } = await jwtVerify(token, this.jwks, {
          ...options,
          algorithms: ['RS256'],
        }));
      else throw new Error();
      const claims = claimsSchema.parse(payload);
      if (
        claims.iat > Date.now() / 1000 + 30 ||
        claims.exp <= claims.iat ||
        claims.exp <= claims.nbf
      )
        throw new Error();
      request.userId = claims.sub;
      return true;
    } catch {
      throw new HttpException('Invalid access token', 401);
    }
  }
}
const cursorSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
});
const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(512).optional(),
    unreadOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    eventType: eventTypeSchema.optional(),
    status: statusSchema.optional(),
  })
  .strict();

const inboxListQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]\d?|100)$/)
      .optional(),
    cursor: z.string().max(512).optional(),
    unreadOnly: z.enum(['true', 'false']).optional(),
    category: z
      .enum(['WORKFLOW', 'WORKSPACE', 'CONNECTION', 'SECURITY'])
      .optional(),
    locale: z.enum(['vi', 'en']).optional(),
  })
  .strict();
const inboxReadQuerySchema = z
  .object({ locale: z.enum(['vi', 'en']).optional() })
  .strict();
const emptyQuerySchema = z.object({}).strict();
const inboxCursorSchema = z
  .object({ id: z.uuid(), createdAt: z.iso.datetime({ offset: true }) })
  .strict();
@Controller(['api/v1/notifications', 'api/notifications'])
@UseGuards(AccessGuard)
export class NotificationsController {
  constructor(private readonly notifications: Notifications) {}
  @Get()
  list(@Req() req: Request, @Query() query: unknown) {
    const result = querySchema.safeParse(query);
    if (!result.success)
      throw new BadRequestException('Invalid notification query');
    const { cursor, ...rest } = result.data;
    let parsedCursor: { id: string; createdAt: Date } | undefined;
    if (cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
        const value = cursorSchema.parse(
          JSON.parse(Buffer.from(cursor, 'base64url').toString()),
        );
        parsedCursor = { id: value.id, createdAt: new Date(value.createdAt) };
      } catch {
        throw new BadRequestException('Invalid notification cursor');
      }
    }
    return this.notifications.list(req.userId, {
      ...rest,
      cursor: parsedCursor,
    });
  }
  @Get('unread-count') count(@Req() req: Request) {
    return this.notifications.unreadCount(req.userId);
  }
  @Post('read-all') @HttpCode(200) readAll(@Req() req: Request) {
    return this.notifications.markAllRead(req.userId);
  }
  @Patch(':id/read') read(@Req() req: Request, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success)
      throw new BadRequestException('Invalid notification id');
    return this.notifications.markRead(req.userId, id);
  }
}

@Controller('api/v2/notifications')
@UseGuards(AccessGuard)
export class InboxNotificationsController {
  constructor(private readonly notifications: InboxNotifications) {}

  @Get()
  async list(@Req() req: Request, @Query() query: unknown) {
    const result = inboxListQuerySchema.safeParse(query);
    if (!result.success)
      throw new BadRequestException('Invalid notification query');
    const locale: NotificationLocale = result.data.locale ?? 'vi';
    let cursor: InboxQuery['cursor'];
    if (result.data.cursor !== undefined) {
      try {
        const encoded = result.data.cursor;
        if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
        const decoded = Buffer.from(encoded, 'base64url');
        if (decoded.toString('base64url') !== encoded) throw new Error();
        const parsed = inboxCursorSchema.parse(
          JSON.parse(decoded.toString('utf8')),
        );
        cursor = { id: parsed.id, createdAt: new Date(parsed.createdAt) };
      } catch {
        throw new BadRequestException('Invalid notification cursor');
      }
    }
    const filters: InboxQuery = {
      limit: result.data.limit === undefined ? 20 : Number(result.data.limit),
      unreadOnly: result.data.unreadOnly === 'true',
      ...(result.data.category ? { category: result.data.category } : {}),
      ...(cursor ? { cursor } : {}),
    };
    return this.notifications.list(req.userId, filters, locale);
  }

  @Get('unread-count')
  unreadCount(@Req() req: Request, @Query() query: unknown) {
    if (!emptyQuerySchema.safeParse(query).success)
      throw new BadRequestException('Invalid notification query');
    return this.notifications.unreadCount(req.userId);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@Req() req: Request, @Query() query: unknown) {
    if (!emptyQuerySchema.safeParse(query).success)
      throw new BadRequestException('Invalid notification query');
    return this.notifications.markAllRead(req.userId);
  }

  @Patch(':id/read')
  markRead(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    if (!z.uuid().safeParse(id).success)
      throw new BadRequestException('Invalid notification id');
    const result = inboxReadQuerySchema.safeParse(query);
    if (!result.success)
      throw new BadRequestException('Invalid notification query');
    return this.notifications.markRead(
      req.userId,
      id,
      result.data.locale ?? 'vi',
    );
  }
}

@Controller()
export class HealthController {
  constructor(
    private readonly repo: DeliveryRepository,
    private readonly inboxRepository: InboxRepository,
    private readonly rabbit: RabbitConsumer,
  ) {}
  @Get('health') health() {
    return { status: 'UP' };
  }
  @Get('ready') async ready() {
    if (
      !this.rabbit.isReady ||
      !(await this.repo.ready()) ||
      !(await this.inboxRepository.ready())
    )
      throw new HttpException('Dependencies unavailable', 503);
    return { status: 'UP' };
  }
}
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      503: 'SERVICE_UNAVAILABLE',
    };
    void reply.code(status).send({
      error: {
        code: codes[status] ?? 'INTERNAL_ERROR',
        message:
          status >= 500
            ? 'Service temporarily unavailable'
            : (exception as HttpException).message,
        details: [],
      },
      status,
      timestamp: new Date().toISOString(),
      path: request.url.split('?')[0],
    });
  }
}
