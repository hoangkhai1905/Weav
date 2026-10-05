import {
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AI_DEPS } from '../../ai-deps';
import type { AiDeps } from '../../ai-deps';
import { runAssistant } from '../../application/assistant/chat';
import { AiError } from '../../domain/errors';
import { Admission } from '../../infrastructure/admission';
import { FixedWindowLimiter } from '../../infrastructure/fixed-window-limiter';
import './request-signal';

const bodySchema = z
  .object({
    workspaceId: z.uuid(),
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
  .strict()
  .refine((body) => body.messages[body.messages.length - 1].role === 'user');

/** Streams one assistant turn as SSE (events: delta, tool_call, tool_result, done, error). */
@Controller('v1/assistant')
export class AssistantController {
  private readonly logger = new Logger('AssistantController');
  private readonly limiter: FixedWindowLimiter;
  private readonly admission: Admission;

  constructor(@Inject(AI_DEPS) private readonly deps: AiDeps) {
    this.admission = new Admission(
      deps.config.AI_ASSISTANT_MAX_CONCURRENT,
      deps.config.AI_MAX_CONCURRENCY_PER_WORKSPACE,
    );
    this.limiter = new FixedWindowLimiter(
      deps.config.AI_ASSISTANT_RATE_LIMIT_PER_MINUTE,
    );
  }

  @Post('chat')
  @HttpCode(200)
  async chat(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const startedAt = Date.now();
    const assistant = this.deps.assistant;
    // Authenticate first so config state is never revealed to unauthenticated callers.
    if (!assistant?.verifier) throw new AiError('UNAUTHENTICATED');
    const { userId } = await assistant.verifier.verify(
      request.headers.authorization,
    );
    if (!assistant.provider) throw new AiError('AI_NOT_CONFIGURED');
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) throw new AiError('INVALID_REQUEST');
    if (!this.limiter.tryHit(userId)) throw new AiError('AI_BUSY');
    // Separate pool from the service-JWT routes; per-user concurrency reuses the per-workspace cap.
    const release = this.admission.tryAcquire(`user:${userId}`);
    if (!release) throw new AiError('AI_BUSY');

    const signal = request.aiSignal;
    const raw = reply.raw;
    reply.hijack();
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(request.correlationId
        ? { 'x-correlation-id': request.correlationId }
        : {}),
    });
    const send = (event: string, data: unknown) => {
      if (!raw.writableEnded && !raw.destroyed)
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let outcome = 'OK';
    try {
      for await (const item of runAssistant(
        assistant.provider,
        {
          messages: parsed.data.messages,
          maxTokens: this.deps.config.AI_ASSISTANT_MAX_TOKENS,
          tools: {
            workspaceId: parsed.data.workspaceId,
            authorization: request.headers.authorization as string,
            workflowApiUrl: this.deps.config.AI_WORKFLOW_API_URL,
            signal,
          },
        },
        signal,
      )) {
        send(item.event, item.data);
      }
      if (signal.aborted) outcome = 'ABORTED';
    } catch (error) {
      const failure =
        error instanceof AiError ? error : new AiError('INTERNAL_ERROR');
      outcome = failure.code;
      if (failure.code === 'INTERNAL_ERROR')
        this.logger.error({ errorClass: (error as Error)?.constructor?.name });
      send('error', { code: failure.code, message: failure.message });
    } finally {
      release();
      raw.end();
      this.logger.log({
        correlationId: request.correlationId,
        userId,
        workspaceId: parsed.data.workspaceId,
        outcome,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}
