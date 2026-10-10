import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import type { GatewayConfig } from '../config/gateway.config';
import {
  applyClientForwardingHeaders,
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

const MAX_WORKFLOW_REQUEST_BYTES = 1_048_576;
const uuidSchema = z.string().uuid();
const recordSchema = z.record(z.string(), z.unknown());
const queryInteger = (minimum: number, maximum?: number) => {
  const schema = z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(minimum));
  return maximum === undefined
    ? schema
    : schema.pipe(z.number().int().max(maximum));
};

const pageQuerySchema = z
  .object({
    page: queryInteger(0).optional(),
    size: queryInteger(1, 100).optional(),
  })
  .strict();

const logQuerySchema = z
  .object({
    logPage: queryInteger(0).optional(),
    logSize: queryInteger(1, 100).optional(),
  })
  .strict();

const createWorkflowSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
  })
  .strict();

const saveDraftSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    definition: recordSchema,
    editorState: recordSchema.optional(),
    expectedRevision: z.number().int().min(0).optional(),
  })
  .strict();

const manualExecutionSchema = z
  .object({
    input: recordSchema,
  })
  .strict();

// W6-A monitoring: workspace run history, summary and alert rules.
const executionStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]);
const isoInstantSchema = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/);
const runHistoryQuerySchema = z
  .object({
    status: executionStatusSchema.optional(),
    workflowId: uuidSchema.optional(),
    from: isoInstantSchema.optional(),
    to: isoInstantSchema.optional(),
    page: queryInteger(0).optional(),
    size: queryInteger(1, 100).optional(),
  })
  .strict();
const summaryQuerySchema = z
  .object({ days: queryInteger(1, 30).optional() })
  .strict();
const alertRuleSchema = z
  .object({
    name: z.string().min(1).max(120),
    type: z.enum(['CONSECUTIVE_FAILURES', 'LONG_RUNNING']),
    workflowId: uuidSchema.nullable().optional(),
    threshold: z.number().int().min(1).max(86_400),
    windowMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
    cooldownMinutes: z.number().int().min(0).max(10_080).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

// W6-C1 shared templates.
const templateVisibilitySchema = z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']);
const shareTemplateSchema = z
  .object({
    name: z.string().min(1).max(255),
    // null means "absent" for the optional fields (clients serialise cleared inputs as null).
    description: z.string().max(2000).nullable().optional(),
    authorName: z.string().max(120).nullable().optional(),
    visibility: templateVisibilitySchema,
  })
  .strict();
const patchTemplateSchema = z
  .object({
    name: z.string().min(1).max(255).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    visibility: templateVisibilitySchema.nullable().optional(),
  })
  .strict();
const useTemplateSchema = z
  .object({
    workspaceId: uuidSchema,
    name: z.string().min(1).max(255).nullable().optional(),
  })
  .strict();
const templateListQuerySchema = z
  .object({
    scope: z.enum(['public', 'workspace', 'mine']).optional(),
    workspaceId: uuidSchema.optional(),
    q: z.string().max(100).optional(),
    page: queryInteger(0).optional(),
    size: queryInteger(1, 100).optional(),
  })
  .strict();
// Share codes are typed by people: letters, digits, spaces and dashes (the service normalises them).
const templateCodeSchema = z.string().regex(/^[A-Za-z0-9 -]{1,32}$/);

type WorkflowMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface WorkflowForwardOptions {
  body?: unknown;
  query?: Record<string, number | string>;
  /** Upstream deadline; defaults to 15 s. */
  timeoutMs?: number;
  /** Serialized JSON body cap; defaults to 1 MiB. */
  maxBodyBytes?: number;
  /** 'none' is only for the public webhook ingress; Authorization is then never forwarded. */
  auth?: 'required' | 'none';
  extraHeaders?: Record<string, string>;
}

// Workflow spec: generate accepts at most 32 KiB and may take ~65 s of AI time
// plus Workspace checks, so the edge deadline is 80 s (other routes keep 15 s).
const MAX_GENERATE_REQUEST_BYTES = 32_768;
const GENERATE_TIMEOUT_MS = 80_000;
const WEBHOOK_ENDPOINT_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const WEBHOOK_SECRET_PATTERN = /^[\x21-\x7e]{1,512}$/;
// Telegram's secret_token alphabet and length (setWebhook): 1-256 of A-Z a-z 0-9 _ -.
const TELEGRAM_SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

const generateWorkflowSchema = z
  .object({
    prompt: z.string().min(1).max(16_000),
    timezone: z.string().min(1).max(64).optional(),
    connections: z.record(z.string().max(128), z.string().uuid()).optional(),
    answers: z
      .record(z.string().min(1).max(200), z.string().min(1).max(4_000))
      .optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException('Request validation failed');
  }
  return result.data;
}

function workflowId(value: string): string {
  return parse(uuidSchema, value);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

@Injectable()
export class WorkflowProxyService {
  private readonly logger = new Logger(WorkflowProxyService.name);

  constructor(private readonly config: ConfigService) {}

  async forward(
    method: WorkflowMethod,
    request: FastifyRequest,
    reply: FastifyReply,
    path: string,
    options: WorkflowForwardOptions = {},
  ): Promise<unknown> {
    const context = request as RequestContextCarrier;
    const requestId = getRequestId(context);
    setResponseRequestId(reply, requestId);
    reply.header('Cache-Control', 'no-store');

    const fail = (status: number, code: string, message: string) => {
      const raw = context.raw as
        { aborted?: boolean; destroyed?: boolean } | undefined;
      if (reply.sent || raw?.aborted === true || raw?.destroyed === true) {
        return undefined;
      }
      reply.header('Content-Type', 'application/json; charset=utf-8');
      setResponseRequestId(reply, requestId);
      reply.header('Cache-Control', 'no-store');
      return reply.code(status).send({
        error: { code, message, details: [] },
        status,
        requestId,
      });
    };

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };
    if (options.auth !== 'none') {
      const authorization = getRequestHeader(request.headers, 'authorization');
      if (
        !authorization ||
        authorization.length > 8192 ||
        !/^Bearer \S+$/i.test(authorization)
      ) {
        return fail(401, 'UNAUTHORIZED', 'Bearer token required');
      }
      headers.authorization = authorization;
    }
    const traceparent = getRequestHeader(request.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) {
      headers.traceparent = traceparent;
    }
    const userAgent = getRequestHeader(request.headers, 'user-agent');
    if (userAgent) {
      headers['user-agent'] = userAgent.slice(0, 512);
    }
    applyClientForwardingHeaders(request, headers, method);
    Object.assign(headers, options.extraHeaders);

    let serializedBody: string | undefined;
    if (options.body !== undefined) {
      serializedBody = JSON.stringify(options.body);
      const maxBodyBytes = options.maxBodyBytes ?? MAX_WORKFLOW_REQUEST_BYTES;
      if (Buffer.byteLength(serializedBody, 'utf8') > maxBodyBytes) {
        return fail(413, 'PAYLOAD_TOO_LARGE', 'Request too large');
      }
      headers['content-type'] = 'application/json';
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      query.set(key, String(value));
    }
    const queryString = query.toString();
    const targetPath = `${path}${queryString ? `?${queryString}` : ''}`;
    const gateway = this.config.get<GatewayConfig>('gateway');
    const base =
      gateway?.upstreams?.workflow ??
      this.config.get<string>('WORKFLOW_SERVICE_URL') ??
      'http://workflow-service:8080';
    const abortHandle = createUpstreamAbortHandle(
      context,
      reply,
      options.timeoutMs ?? 15_000,
    );

    try {
      const response = await fetch(`${base.replace(/\/+$/, '')}${targetPath}`, {
        method,
        headers,
        body: serializedBody,
        redirect: 'error',
        signal: abortHandle.signal,
      });
      const responseHeaders = collectSafeUpstreamResponseHeaders(
        response.headers,
      );

      if (response.status === 204) {
        setResponseRequestId(reply, requestId);
        reply.header('Cache-Control', 'no-store');
        return reply.code(204).send();
      }

      if (
        !responseHeaders['content-type']
          ?.toLowerCase()
          .includes('application/json')
      ) {
        try {
          await response.body?.cancel();
        } catch {
          // The upstream connection is already being discarded.
        }
        return fail(502, 'BAD_GATEWAY', 'Invalid Workflow response');
      }

      let responseBody: unknown;
      try {
        responseBody = await readJson(response);
      } catch {
        return fail(502, 'BAD_GATEWAY', 'Invalid Workflow response');
      }

      for (const [name, value] of Object.entries(responseHeaders)) {
        if (name !== 'cache-control') {
          reply.header(name, value);
        }
      }
      setResponseRequestId(reply, requestId);
      reply.header('Cache-Control', 'no-store');
      return reply.code(response.status).send(responseBody);
    } catch {
      if (isWriteTimeout(abortHandle, method)) {
        return fail(
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.status,
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.code,
          UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.message,
        );
      }
      this.logger.error(`Workflow upstream failed requestId=${requestId}`);
      return fail(503, 'SERVICE_UNAVAILABLE', 'Workflow service unavailable');
    } finally {
      abortHandle.cleanup();
    }
  }
}

@Controller('api/v1/workspaces/:workspaceId/workflows')
@AuthPolicy('required')
export class WorkflowProxyController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Post()
  create(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const id = workflowId(rawWorkspaceId);
    const parsed = parse(createWorkflowSchema, body);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${id}/workflows`,
      {
        body: parsed,
      },
    );
  }

  @Post('generate')
  generate(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const id = workflowId(rawWorkspaceId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${id}/workflows/generate`,
      {
        body: parse(generateWorkflowSchema, body),
        maxBodyBytes: MAX_GENERATE_REQUEST_BYTES,
        timeoutMs: GENERATE_TIMEOUT_MS,
      },
    );
  }

  @Get()
  list(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const id = workflowId(rawWorkspaceId);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/workspaces/${id}/workflows`,
      { query: parse(pageQuerySchema, query) },
    );
  }

  // Static segment: must stay registered next to (and wins over) :workflowId.
  @Get('node-capabilities')
  nodeCapabilities(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = workflowId(rawWorkspaceId);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/workspaces/${id}/workflows/node-capabilities`,
    );
  }

  @Get(':workflowId')
  get(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}`,
    );
  }

  @Put(':workflowId/draft')
  saveDraft(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'PUT',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/draft`,
      { body: parse(saveDraftSchema, body) },
    );
  }

  @Post(':workflowId/publish')
  publish(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/publish`,
    );
  }

  @Delete(':workflowId')
  remove(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'DELETE',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}`,
    );
  }

  @Post(':workflowId/pause')
  pause(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/pause`,
    );
  }

  @Post(':workflowId/resume')
  resume(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/resume`,
    );
  }

  @Post(':workflowId/executions')
  manualExecution(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/executions`,
      { body: parse(manualExecutionSchema, body) },
    );
  }

  @Get(':workflowId/executions')
  executions(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/executions`,
      { query: parse(pageQuerySchema, query) },
    );
  }

  @Get(':workflowId/executions/:executionId')
  execution(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Param('executionId') rawExecutionId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    const execution = workflowId(rawExecutionId);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/executions/${execution}`,
      { query: parse(logQuerySchema, query) },
    );
  }

  // W6-C3: stop a run (needs WORKFLOW_RUN; Workflow Service answers 202, 404 or 409).
  @Post(':workflowId/executions/:executionId/cancel')
  cancelExecution(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Param('executionId') rawExecutionId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    const execution = workflowId(rawExecutionId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/executions/${execution}/cancel`,
    );
  }
}

/** Workspace-wide monitoring: run history, metrics summary and alert rules (W6-A). */
@Controller('api/v1/workspaces/:workspaceId')
@AuthPolicy('required')
export class MonitoringProxyController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Get('executions')
  history(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/workspaces/${workspace}/executions`,
      { query: parse(runHistoryQuerySchema, query) },
    );
  }

  @Get('monitoring/summary')
  summary(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/workspaces/${workspace}/monitoring/summary`,
      { query: parse(summaryQuerySchema, query) },
    );
  }

  @Get('alert-rules')
  listRules(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/workspaces/${workspace}/alert-rules`,
    );
  }

  @Post('alert-rules')
  createRule(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${workspace}/alert-rules`,
      { body: parse(alertRuleSchema, body) },
    );
  }

  @Put('alert-rules/:ruleId')
  updateRule(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('ruleId') rawRuleId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const rule = workflowId(rawRuleId);
    return this.proxy.forward(
      'PUT',
      request,
      reply,
      `/workspaces/${workspace}/alert-rules/${rule}`,
      { body: parse(alertRuleSchema, body) },
    );
  }

  @Delete('alert-rules/:ruleId')
  deleteRule(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('ruleId') rawRuleId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const rule = workflowId(rawRuleId);
    return this.proxy.forward(
      'DELETE',
      request,
      reply,
      `/workspaces/${workspace}/alert-rules/${rule}`,
    );
  }
}

// ---- W6-C1 shared templates ------------------------------------------------

@Controller('api/v1/workspaces/:workspaceId/workflows/:workflowId/template')
@AuthPolicy('required')
export class WorkflowTemplateProxyController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Post('preview')
  preview(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/template/preview`,
    );
  }

  @Put()
  share(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('workflowId') rawWorkflowId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const workspace = workflowId(rawWorkspaceId);
    const workflow = workflowId(rawWorkflowId);
    return this.proxy.forward(
      'PUT',
      request,
      reply,
      `/workspaces/${workspace}/workflows/${workflow}/template`,
      { body: parse(shareTemplateSchema, body) },
    );
  }
}

@Controller('api/v1/templates')
@AuthPolicy('required')
export class TemplateProxyController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Get()
  list(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    return this.proxy.forward('GET', request, reply, '/templates', {
      query: parse(templateListQuerySchema, query),
    });
  }

  @Get('by-code/:code')
  byCode(
    @Param('code') rawCode: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const code = parse(templateCodeSchema, rawCode);
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/templates/by-code/${encodeURIComponent(code)}`,
    );
  }

  @Get(':id')
  get(
    @Param('id') rawId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.proxy.forward(
      'GET',
      request,
      reply,
      `/templates/${workflowId(rawId)}`,
    );
  }

  @Patch(':id')
  patch(
    @Param('id') rawId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(
      'PATCH',
      request,
      reply,
      `/templates/${workflowId(rawId)}`,
      { body: parse(patchTemplateSchema, body) },
    );
  }

  @Delete(':id')
  remove(
    @Param('id') rawId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.proxy.forward(
      'DELETE',
      request,
      reply,
      `/templates/${workflowId(rawId)}`,
    );
  }

  @Post(':id/use')
  use(
    @Param('id') rawId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/templates/${workflowId(rawId)}/use`,
      { body: parse(useTemplateSchema, body) },
    );
  }
}

/**
 * Public webhook ingress (UC021). No JWT: Workflow authenticates the
 * X-Webhook-Secret against the endpoint key. Client Authorization is never
 * forwarded, and only JSON bodies are accepted (the Workflow contract).
 */
@Controller('api/v1/webhooks')
@AuthPolicy('public')
export class WebhookProxyController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Post(':endpointKey')
  accept(
    @Param('endpointKey') endpointKey: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    if (!WEBHOOK_ENDPOINT_KEY_PATTERN.test(endpointKey)) {
      throw new BadRequestException('Request validation failed');
    }
    const contentType = getRequestHeader(request.headers, 'content-type');
    if (
      body !== undefined &&
      !contentType?.toLowerCase().startsWith('application/json')
    ) {
      throw new UnsupportedMediaTypeException('application/json required');
    }
    const extraHeaders: Record<string, string> = {};
    const secret = getRequestHeader(request.headers, 'x-webhook-secret');
    if (secret !== undefined) {
      if (!WEBHOOK_SECRET_PATTERN.test(secret)) {
        throw new BadRequestException('Request validation failed');
      }
      extraHeaders['x-webhook-secret'] = secret;
    }
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/webhooks/${endpointKey}`,
      { body, auth: 'none', extraHeaders },
    );
  }
}

/**
 * Telegram bot updates for a trigger.telegram registration. Telegram calls this
 * URL (registered with setWebhook), not a user, so there is no JWT. Only the
 * X-Telegram-Bot-Api-Secret-Token header is forwarded; client Authorization
 * never is. Workflow compares the token in constant time.
 */
@Controller('api/v1/webhooks/telegram')
@AuthPolicy('public')
export class TelegramWebhookProxyController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Post(':endpointKey')
  accept(
    @Param('endpointKey') endpointKey: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    if (!WEBHOOK_ENDPOINT_KEY_PATTERN.test(endpointKey)) {
      throw new BadRequestException('Request validation failed');
    }
    const contentType = getRequestHeader(request.headers, 'content-type');
    if (
      body !== undefined &&
      !contentType?.toLowerCase().startsWith('application/json')
    ) {
      throw new UnsupportedMediaTypeException('application/json required');
    }
    const extraHeaders: Record<string, string> = {};
    const secret = getRequestHeader(
      request.headers,
      'x-telegram-bot-api-secret-token',
    );
    if (secret !== undefined) {
      if (!TELEGRAM_SECRET_TOKEN_PATTERN.test(secret)) {
        throw new BadRequestException('Request validation failed');
      }
      extraHeaders['x-telegram-bot-api-secret-token'] = secret;
    }
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/webhooks/telegram/${endpointKey}`,
      { body, auth: 'none', extraHeaders },
    );
  }
}

@Module({
  controllers: [
    WorkflowProxyController,
    MonitoringProxyController,
    WorkflowTemplateProxyController,
    TemplateProxyController,
    WebhookProxyController,
    TelegramWebhookProxyController,
  ],
  providers: [WorkflowProxyService],
})
export class WorkflowModule {}
