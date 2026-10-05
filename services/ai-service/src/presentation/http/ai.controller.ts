import {
  Controller,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AI_DEPS } from '../../ai-deps';
import type { AiDeps } from '../../ai-deps';
import { classify } from '../../application/classify';
import { extract } from '../../application/extract';
import { generate } from '../../application/generate';
import { prompt } from '../../application/prompt';
import { summarize } from '../../application/summarize';
import { AiError } from '../../domain/errors';
import { Admission } from '../../infrastructure/admission';
import { RequestDedup } from '../../infrastructure/request-dedup';
import { ENVELOPES, isOperation } from './envelopes';
import './request-signal';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OUTPUT_BYTES = 256 * 1024;

@Controller('v1')
export class AiController {
  private readonly logger = new Logger('AiController');
  // AI-1: a retried/recovered attempt reuses its requestId; see RequestDedup.
  private readonly dedup = new RequestDedup<{
    requestId: string;
    result: unknown;
  }>();

  constructor(
    @Inject(AI_DEPS) private readonly deps: AiDeps,
    private readonly admission: Admission,
  ) {}

  @Post(':operation')
  @HttpCode(200)
  async run(
    @Param('operation') operation: string,
    @Req() request: FastifyRequest,
  ) {
    const startedAt = Date.now();
    const { provider, verifier } = this.deps;
    // AI-8: authenticate first so config state is never revealed to unauthenticated callers.
    if (!verifier) throw new AiError('UNAUTHENTICATED');
    const claims = verifier.verify(request.headers.authorization);
    if (!provider) throw new AiError('AI_NOT_CONFIGURED');
    if (!isOperation(operation)) throw new AiError('INVALID_REQUEST');
    const requestId = request.headers['x-request-id'];
    if (typeof requestId !== 'string' || !UUID.test(requestId))
      throw new AiError('INVALID_REQUEST');

    const parsed = ENVELOPES[operation].safeParse(request.body);
    if (!parsed.success) throw new AiError('INVALID_REQUEST');
    const body = parsed.data;
    if (
      claims.scope !== `ai:${operation}` ||
      claims.workspaceId !== body.workspaceId ||
      claims.requestId !== requestId ||
      body.requestId !== requestId ||
      (claims.mode === 'generation') !== (operation === 'generate')
    ) {
      throw new AiError('FORBIDDEN');
    }

    return this.dedup.run(`${body.workspaceId}:${requestId}`, async () => {
      const release = this.admission.tryAcquire(body.workspaceId);
      if (!release) throw new AiError('AI_BUSY');
      let outcome = 'OK';
      try {
        const signal = request.aiSignal;
        const result =
          body.operation === 'extract'
            ? await extract(provider, body, signal)
            : body.operation === 'classify'
              ? await classify(provider, body, signal)
              : body.operation === 'summarize'
                ? await summarize(provider, body, signal)
                : body.operation === 'prompt'
                  ? await prompt(provider, body, signal)
                  : await generate(provider, body, signal);
        if (
          Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_OUTPUT_BYTES
        )
          throw new AiError('AI_OUTPUT_INVALID');
        return { requestId, result };
      } catch (error) {
        outcome = error instanceof AiError ? error.code : 'INTERNAL_ERROR';
        throw error;
      } finally {
        release();
        this.logger.log({
          requestId,
          correlationId: request.correlationId,
          operation,
          workspaceId: body.workspaceId,
          outcome,
          durationMs: Date.now() - startedAt,
        });
      }
    });
  }
}
