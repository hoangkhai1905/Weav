import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Module,
  Param,
  Post,
  Query,
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

// Same bounds as ai-service (message 1..4000 chars); ai-service validates again.
const chatSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    message: z.string().min(1).max(4000),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

const listSchema = z.object({
  workspaceId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});
const idSchema = z.string().uuid();

const JSON_TIMEOUT_MS = 10_000;
const MAX_JSON_BYTES = 65_536;

// Upstream error text is never relayed; only the status class is mapped.
function mapStatus(status: number): number {
  return [400, 401, 404, 413, 429, 503].includes(status) ? status : 502;
}

// Upstream error codes that pass through (gateway-owned message per code), so clients can
// tell e.g. a busy assistant from an exhausted daily quota. Anything else keeps the generic mapping.
const ERROR_MESSAGES: Record<string, string> = {
  AI_BUSY: 'Assistant is busy, try again shortly',
  AI_QUOTA_EXCEEDED: 'Daily assistant quota exceeded',
  NOT_FOUND: 'Not found',
  AI_NOT_CONFIGURED: 'Assistant is not configured',
  AI_UNAVAILABLE: 'Assistant is unavailable',
  UNAUTHENTICATED: 'Authentication required',
  INVALID_REQUEST: 'Invalid request',
  PAYLOAD_TOO_LARGE: 'Request too large',
};

// Reads at most `max` bytes; returns null (and cancels the body) when the upstream sends more.
async function readCapped(
  response: Response,
  max = MAX_JSON_BYTES,
): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function upstreamFailure(response: Response): Promise<HttpException> {
  const status = mapStatus(response.status);
  let code: unknown;
  try {
    const text = await readCapped(response);
    code = (JSON.parse(text ?? '') as { error?: { code?: unknown } }).error
      ?.code;
  } catch {
    code = undefined;
  }
  if (typeof code === 'string' && Object.hasOwn(ERROR_MESSAGES, code)) {
    return new HttpException(
      { error: { code, message: ERROR_MESSAGES[code] } },
      status,
    );
  }
  return new HttpException('Assistant request failed', status);
}

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
      const failure =
        response.status === 200
          ? new HttpException('Assistant request failed', 502)
          : await upstreamFailure(response);
      await response.body?.cancel().catch(() => undefined);
      abort.cleanup();
      throw failure;
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

  @Get('conversations')
  async listConversations(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('Request validation failed');
    }
    const search = new URLSearchParams({
      workspaceId: parsed.data.workspaceId,
    });
    if (parsed.data.limit !== undefined)
      search.set('limit', String(parsed.data.limit));
    if (parsed.data.before) search.set('before', parsed.data.before);
    return this.proxyJson(request, reply, 'GET', `conversations?${search}`);
  }

  @Get('conversations/:conversationId/messages')
  async messages(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('conversationId') conversationId: string,
  ) {
    return this.proxyJson(
      request,
      reply,
      'GET',
      `conversations/${this.conversationId(conversationId)}/messages`,
    );
  }

  @Delete('conversations/:conversationId')
  async remove(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('conversationId') conversationId: string,
  ) {
    return this.proxyJson(
      request,
      reply,
      'DELETE',
      `conversations/${this.conversationId(conversationId)}`,
    );
  }

  private conversationId(value: string): string {
    if (!idSchema.safeParse(value).success) {
      throw new BadRequestException('Invalid conversation id');
    }
    return value;
  }

  // Small JSON proxy for history routes; 2xx body is relayed (size-capped), errors are mapped.
  private async proxyJson(
    request: FastifyRequest,
    reply: FastifyReply,
    method: 'GET' | 'DELETE',
    path: string,
  ) {
    const authorization = getRequestHeader(request.headers, 'authorization');
    if (!authorization || !/^Bearer \S+$/i.test(authorization)) {
      throw new UnauthorizedException('Bearer token required');
    }
    const requestId = getRequestId(request);
    setResponseRequestId(reply, requestId);
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization,
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };
    const traceparent = getRequestHeader(request.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) headers.traceparent = traceparent;

    const gateway = this.config.getOrThrow<GatewayConfig>('gateway');
    const abort = createUpstreamAbortHandle(request, reply, JSON_TIMEOUT_MS);
    let response: Response;
    let text: string | null = '';
    try {
      response = await fetch(
        `${gateway.upstreams.ai.replace(/\/+$/, '')}/v1/assistant/${path}`,
        { method, headers, redirect: 'error', signal: abort.signal },
      );
      if (response.status === 200) text = await readCapped(response);
      else if (response.status !== 204) throw await upstreamFailure(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`AI upstream failed requestId=${requestId}`);
      throw new HttpException('AI service unavailable', 503);
    } finally {
      abort.cleanup();
    }
    if (response.status === 204) return reply.status(204).send();
    if (text === null) throw new HttpException('Assistant request failed', 502);
    return reply
      .status(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .send(text);
  }
}

@Module({ controllers: [AssistantController] })
export class AssistantModule {}
