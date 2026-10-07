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
import {
  conversationTitle,
  isUuid,
  MAX_MESSAGE_CHARS,
} from '../../application/assistant/conversation-store';
import { AiError } from '../../domain/errors';
import { Admission } from '../../infrastructure/admission';
import { FixedWindowLimiter } from '../../infrastructure/fixed-window-limiter';
import { WorkspaceMembership } from '../../infrastructure/workspace-membership';
import { authenticateUser } from './assistant-auth';
import './request-signal';

const validTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const bodySchema = z
  .object({
    // Lowercased so case variants of one id share limiter keys, caches and ownership checks.
    workspaceId: z.uuid().transform((v) => v.toLowerCase()),
    // Malformed ids are a 404 (checked below), not a validation error.
    conversationId: z
      .string()
      .min(1)
      .max(64)
      .transform((v) => v.toLowerCase())
      .optional(),
    message: z.string().min(1).max(4000),
    timezone: z.string().min(1).max(64).refine(validTimezone).optional(),
  })
  .strict();

/** Streams one assistant turn as SSE (events: conversation, delta, tool_call, tool_result, draft, done, error). */
@Controller('v1/assistant')
export class AssistantController {
  private readonly logger = new Logger('AssistantController');
  private readonly limiter: FixedWindowLimiter;
  private readonly workspaceLimiter: FixedWindowLimiter;
  private readonly admission: Admission;
  private readonly membership: WorkspaceMembership;

  constructor(@Inject(AI_DEPS) private readonly deps: AiDeps) {
    this.admission = new Admission(
      deps.config.AI_ASSISTANT_MAX_CONCURRENT,
      deps.config.AI_MAX_CONCURRENCY_PER_WORKSPACE,
    );
    this.limiter = new FixedWindowLimiter(
      deps.config.AI_ASSISTANT_RATE_LIMIT_PER_MINUTE,
    );
    this.workspaceLimiter = new FixedWindowLimiter(
      deps.config.AI_ASSISTANT_WORKSPACE_RATE_LIMIT_PER_MINUTE,
    );
    this.membership = new WorkspaceMembership(deps.config.AI_WORKSPACE_API_URL);
  }

  @Post('chat')
  @HttpCode(200)
  async chat(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const startedAt = Date.now();
    const { config, assistant } = this.deps;
    // Authenticate first so config state is never revealed to unauthenticated callers.
    const userId = await authenticateUser(this.deps, request);
    const store = assistant?.store;
    if (!assistant?.provider || !store) throw new AiError('AI_NOT_CONFIGURED');
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) throw new AiError('INVALID_REQUEST');
    const { workspaceId, conversationId, message, timezone } = parsed.data;
    const authorization = request.headers.authorization as string;
    if (!this.limiter.tryHit(userId)) throw new AiError('AI_BUSY');
    // Separate pool from the service-JWT routes; per-user concurrency reuses the per-workspace cap.
    const release = this.admission.tryAcquire(`user:${userId}`);
    if (!release) throw new AiError('AI_BUSY');

    let id: string;
    let history: { role: 'user' | 'assistant'; content: string }[];
    try {
      // Membership first: a non-member must never count against, or write into, a workspace.
      await this.membership.assertMember(userId, workspaceId, authorization);
      // After membership, so a non-member cannot burn a workspace's per-minute budget.
      if (!this.workspaceLimiter.tryHit(workspaceId))
        throw new AiError('AI_BUSY');
      if (conversationId !== undefined) {
        const existing = isUuid(conversationId)
          ? await store.getConversation(conversationId, userId)
          : null;
        if (!existing || existing.workspaceId !== workspaceId)
          throw new AiError('NOT_FOUND');
      }
      const usage = await store.recordUsage({
        day: new Date().toISOString().slice(0, 10),
        workspaceId,
        userId,
      });
      if (
        usage.userCalls > config.AI_ASSISTANT_DAILY_USER_LIMIT ||
        usage.workspaceCalls > config.AI_ASSISTANT_DAILY_WORKSPACE_LIMIT
      )
        throw new AiError('AI_QUOTA_EXCEEDED');
      id =
        conversationId ??
        (
          await store.createConversation({
            userId,
            workspaceId,
            title: conversationTitle(message),
          })
        ).id;
      await store.appendMessages(id, userId, [
        { role: 'user', content: message },
      ]);
      // Only role and content go to the model (no timestamps or ids).
      history = (
        await store.recentMessages(id, userId, {
          maxMessages: config.AI_ASSISTANT_HISTORY_MESSAGES,
          maxChars: config.AI_ASSISTANT_HISTORY_CHARS,
        })
      ).map(({ role, content }) => ({ role, content }));
    } catch (error) {
      release();
      throw error;
    }
    if (timezone && history.length > 0) {
      // The newest entry is the message just stored; the hint is for the model only.
      const last = history[history.length - 1];
      history[history.length - 1] = {
        ...last,
        content: `${last.content}\n\n[The user's time zone is ${timezone}; use it as the timezone argument of tools that take one.]`,
      };
    }

    const signal = request.aiSignal;
    const raw = reply.raw;
    const send = (event: string, data: unknown) => {
      if (!raw.writableEnded && !raw.destroyed)
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let outcome = 'OK';
    try {
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
      send('conversation', { conversationId: id });
      let answer = '';
      let finished = false;
      for await (const item of runAssistant(
        assistant.provider,
        {
          messages: history,
          maxTokens: config.AI_ASSISTANT_MAX_TOKENS,
          tools: {
            workspaceId,
            authorization,
            workflowApiUrl: config.AI_WORKFLOW_API_URL,
            workspaceApiUrl: config.AI_WORKSPACE_API_URL,
            signal,
          },
        },
        signal,
      )) {
        if (item.event === 'delta') answer += item.data.text;
        if (item.event === 'done') {
          finished = true;
          // Stored only after a successful turn, and before `done` so a failed save becomes an error event.
          if (answer.trim())
            await store.appendMessages(id, userId, [
              {
                role: 'assistant',
                content: answer.slice(0, MAX_MESSAGE_CHARS),
              },
            ]);
        }
        send(item.event, item.data);
      }
      if (!finished && signal.aborted) {
        if (request.aiDeadline.aborted) {
          outcome = 'AI_TIMEOUT';
          const timeout = new AiError('AI_TIMEOUT');
          send('error', { code: timeout.code, message: timeout.message });
        } else outcome = 'ABORTED';
      }
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
        workspaceId,
        conversationId: id,
        outcome,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}
