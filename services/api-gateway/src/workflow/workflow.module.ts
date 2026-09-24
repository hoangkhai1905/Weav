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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import type { GatewayConfig } from '../config/gateway.config';
import {
  collectSafeUpstreamResponseHeaders,
  createUpstreamAbortHandle,
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
  const schema = z.string().regex(/^\d+$/).transform(Number).pipe(
    z.number().int().min(minimum),
  );
  return maximum === undefined
    ? schema
    : schema.pipe(z.number().int().max(maximum));
};

const pageQuerySchema = z.object({
  page: queryInteger(0).optional(),
  size: queryInteger(1, 100).optional(),
}).strict();

const logQuerySchema = z.object({
  logPage: queryInteger(0).optional(),
  logSize: queryInteger(1, 100).optional(),
}).strict();

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
}).strict();

const saveDraftSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  definition: recordSchema,
  editorState: recordSchema.optional(),
}).strict();

const manualExecutionSchema = z.object({
  input: recordSchema,
}).strict();

type WorkflowMethod = 'GET' | 'POST' | 'PUT';

interface WorkflowForwardOptions {
  body?: unknown;
  query?: Record<string, number>;
}

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

    const authorization = getRequestHeader(request.headers, 'authorization');
    if (
      !authorization ||
      authorization.length > 8192 ||
      !/^Bearer \S+$/i.test(authorization)
    ) {
      return fail(401, 'UNAUTHORIZED', 'Bearer token required');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization,
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };
    const traceparent = getRequestHeader(request.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) {
      headers.traceparent = traceparent;
    }
    const userAgent = getRequestHeader(request.headers, 'user-agent');
    if (userAgent) {
      headers['user-agent'] = userAgent.slice(0, 512);
    }

    let serializedBody: string | undefined;
    if (options.body !== undefined) {
      serializedBody = JSON.stringify(options.body);
      if (Buffer.byteLength(serializedBody, 'utf8') > MAX_WORKFLOW_REQUEST_BYTES) {
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
    const abortHandle = createUpstreamAbortHandle(context, reply, 15_000);

    try {
      const response = await fetch(
        `${base.replace(/\/+$/, '')}${targetPath}`,
        {
          method,
          headers,
          body: serializedBody,
          redirect: 'error',
          signal: abortHandle.signal,
        },
      );
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
      this.logger.error(`Workflow upstream failed requestId=${requestId}`);
      return fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Workflow service unavailable',
      );
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
    return this.proxy.forward('POST', request, reply, `/workspaces/${id}/workflows`, {
      body: parsed,
    });
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
      'GET', request, reply, `/workspaces/${id}/workflows`,
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
      'GET', request, reply,
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
      'PUT', request, reply,
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
      'POST', request, reply,
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
      'POST', request, reply,
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
      'POST', request, reply,
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
      'POST', request, reply,
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
      'GET', request, reply,
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
      'GET', request, reply,
      `/workspaces/${workspace}/workflows/${workflow}/executions/${execution}`,
      { query: parse(logQuerySchema, query) },
    );
  }
}

@Module({
  controllers: [WorkflowProxyController],
  providers: [WorkflowProxyService],
})
export class WorkflowModule {}
