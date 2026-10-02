import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
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

type WorkflowMethod = 'GET' | 'POST' | 'PUT';

interface WorkflowForwardOptions {
  body?: unknown;
  query?: Record<string, number>;
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

const generateWorkflowSchema = z
  .object({
    prompt: z.string().min(1).max(16_000),
    timezone: z.string().min(1).max(64).optional(),
    connections: z.record(z.string().max(128), z.string().uuid()).optional(),
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

@Module({
  controllers: [WorkflowProxyController, WebhookProxyController],
  providers: [WorkflowProxyService],
})
export class WorkflowModule {}
