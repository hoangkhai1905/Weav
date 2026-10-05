import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Logger,
  Module,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { z } from 'zod';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import type { GatewayConfig } from '../config/gateway.config';
import {
  createUpstreamAbortHandle,
  getRequestHeader,
  getRequestId,
  isValidTraceparent,
  setResponseRequestId,
  type RequestContextCarrier,
} from '../common/request-context';

const MAX_REQUEST_BYTES = 262_144;
// Above ai-service's own 60 s deadline, so the upstream reports its error event first.
const STREAM_TIMEOUT_MS = 75_000;

// Same bounds as ai-service (max 20 messages, 4000 chars each); ai-service validates again.
const chatSchema = z
  .object({
    workspaceId: z.string().uuid(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

/**
 * Assistant chat (SSE). Authenticated by the normal access-token guard; the caller's own
 * Authorization header is forwarded because ai-service calls workflow-service as that user.
 * The upstream body is piped through without buffering, never compressed.
 */
@Controller('api/v1/assistant')
@AuthPolicy('required')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(private readonly config: ConfigService) {}

  @Post('chat')
  @HttpCode(200)
  async chat(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Request validation failed');
    }
    const payload = JSON.stringify(parsed.data);
    if (Buffer.byteLength(payload, 'utf8') > MAX_REQUEST_BYTES) {
      throw new HttpException('Request too large', 413);
    }
    const authorization = getRequestHeader(request.headers, 'authorization');
    if (!authorization || !/^Bearer \S+$/i.test(authorization)) {
      throw new UnauthorizedException('Bearer token required');
    }

    const context = request as RequestContextCarrier;
    const requestId = getRequestId(context);
    setResponseRequestId(reply, requestId);
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      authorization,
      'content-type': 'application/json',
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };
    const traceparent = getRequestHeader(request.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) headers.traceparent = traceparent;

    const gateway = this.config.getOrThrow<GatewayConfig>('gateway');
    const abort = createUpstreamAbortHandle(context, reply, STREAM_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(
        `${gateway.upstreams.ai.replace(/\/+$/, '')}/v1/assistant/chat`,
        {
          method: 'POST',
          headers,
          body: payload,
          redirect: 'error',
          signal: abort.signal,
        },
      );
    } catch {
      abort.cleanup();
      this.logger.error(`AI upstream failed requestId=${requestId}`);
      throw new HttpException('AI service unavailable', 503);
    }

    const isStream =
      response.status === 200 &&
      (response.headers.get('content-type') ?? '')
        .toLowerCase()
        .startsWith('text/event-stream') &&
      response.body !== null;
    if (!isStream) {
      await response.body?.cancel().catch(() => undefined);
      abort.cleanup();
      // Upstream error text is never relayed; only the status class is mapped.
      const status = [400, 401, 404, 413, 429, 503].includes(response.status)
        ? response.status
        : 502;
      throw new HttpException('Assistant request failed', status);
    }

    // Fastify pipes a Node stream chunk by chunk (no Content-Length, no buffering).
    const stream = Readable.fromWeb(
      response.body as unknown as WebReadableStream,
    );
    stream.once('close', () => abort.cleanup());
    reply
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('X-Accel-Buffering', 'no');
    return reply.send(stream);
  }
}

@Module({ controllers: [AssistantController] })
export class AssistantModule {}
