import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
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

@Controller(['api/v1/notifications', 'api/notifications'])
export class NotificationProxyController {
  constructor(private readonly config: ConfigService) {}
  @Get() list(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: Record<string, string>,
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== 'string' || value.length > 512)
        throw new BadRequestException();
      params.set(key, value);
    }
    return this.forward(request, reply, '', params.toString());
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
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException();
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
    const authorization = req.headers.authorization;
    if (
      !authorization ||
      authorization.length > 8192 ||
      !/^Bearer \S+$/i.test(authorization)
    )
      throw new HttpException('Bearer token required', 401);
    const base =
      this.config.get<string>('NOTIFICATION_SERVICE_URL') ??
      'http://notification-service:3000';
    try {
      const response = await fetch(
        `${base.replace(/\/$/, '')}/api/v1/notifications${path}${query ? `?${query}` : ''}`,
        {
          method: req.method,
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: { authorization },
        },
      );
      const body = (await response.json()) as unknown;
      return reply.code(response.status).send(body);
    } catch {
      return reply.code(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Notification service unavailable',
          details: [],
        },
        status: 503,
      });
    }
  }
}
@Module({ controllers: [NotificationProxyController] })
export class NotificationsModule {}
