import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AI_DEPS } from '../../ai-deps';
import type { AiDeps } from '../../ai-deps';
import {
  isUuid,
  type ConversationStore,
} from '../../application/assistant/conversation-store';
import { AiError } from '../../domain/errors';
import { FixedWindowLimiter } from '../../infrastructure/fixed-window-limiter';
import { authenticateUser } from './assistant-auth';

const MAX_MESSAGES = 100;
const listQuery = z
  .object({
    workspaceId: z.uuid().transform((v) => v.toLowerCase()),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
  })
  .strict();

/** Per-user chat history. Every lookup is owner-filtered by the store; a miss is always 404. */
@Controller('v1/assistant/conversations')
export class AssistantHistoryController {
  private readonly limiter: FixedWindowLimiter;

  constructor(@Inject(AI_DEPS) private readonly deps: AiDeps) {
    // Own budget: polling history must not eat the chat limit.
    this.limiter = new FixedWindowLimiter(
      deps.config.AI_ASSISTANT_HISTORY_RATE_LIMIT_PER_MINUTE,
    );
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const { userId, store } = await this.caller(request);
    const query = listQuery.safeParse(request.query);
    if (!query.success) throw new AiError('INVALID_REQUEST');
    const rows = await store.listConversations(userId, query.data.workspaceId, {
      limit: query.data.limit,
      before: query.data.before,
    });
    return {
      items: rows.map((c) => ({
        conversationId: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  }

  @Get(':id/messages')
  async messages(@Req() request: FastifyRequest, @Param('id') rawId: string) {
    const id = rawId.toLowerCase();
    const { userId, store } = await this.caller(request);
    const conversation = isUuid(id)
      ? await store.getConversation(id, userId)
      : null;
    if (!conversation) throw new AiError('NOT_FOUND');
    const messages = await store.recentMessages(id, userId, {
      maxMessages: MAX_MESSAGES,
      maxChars: Number.MAX_SAFE_INTEGER,
    });
    return {
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      title: conversation.title,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() request: FastifyRequest, @Param('id') rawId: string) {
    const id = rawId.toLowerCase();
    const { userId, store } = await this.caller(request);
    if (!isUuid(id) || !(await store.deleteConversation(id, userId)))
      throw new AiError('NOT_FOUND');
  }

  private async caller(
    request: FastifyRequest,
  ): Promise<{ userId: string; store: ConversationStore }> {
    const userId = await authenticateUser(this.deps, request);
    if (!this.limiter.tryHit(userId)) throw new AiError('AI_BUSY');
    const store = this.deps.assistant?.store;
    if (!store) throw new AiError('AI_NOT_CONFIGURED');
    return { userId, store };
  }
}
