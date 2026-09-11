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
import { verify } from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Notifications } from '../application/notifications';
import {
  DeliveryRepository,
  eventTypeSchema,
  statusSchema,
} from '../domain/notification';
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
  constructor(@Inject(SETTINGS) private readonly settings: Settings) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    try {
      const authorization = request.headers.authorization;
      if (
        !authorization ||
        authorization.length > 8192 ||
        !/^Bearer \S+$/i.test(authorization)
      )
        throw new Error();
      const claims = claimsSchema.parse(
        verify(authorization.slice(7), this.settings.JWT_ACCESS_SECRET, {
          algorithms: ['HS256'],
          issuer: this.settings.JWT_ISSUER,
          audience: this.settings.JWT_AUDIENCE,
          clockTolerance: 30,
        }),
      );
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
@Controller()
export class HealthController {
  constructor(
    private readonly repo: DeliveryRepository,
    private readonly rabbit: RabbitConsumer,
  ) {}
  @Get('health') health() {
    return { status: 'UP' };
  }
  @Get('ready') async ready() {
    if (!this.rabbit.isReady || !(await this.repo.ready()))
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
