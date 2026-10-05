import { z } from 'zod';
import { isPlainObject } from '../../domain/errors';
import type { ChatToolSpec } from './chat-provider';

export interface ToolContext {
  workspaceId: string;
  /** The caller's own `Authorization: Bearer ...` header value; never a service token. */
  authorization: string;
  workflowApiUrl: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** `ok:false` results carry only a stable error code, never upstream text. */
export interface ToolOutcome {
  ok: boolean;
  data: unknown;
}

const MAX_RESPONSE_BYTES = 512 * 1024;
const TOOL_TIMEOUT_MS = 10_000;
const MAX_TEXT = 300;

const listArgs = z.object({}).strict();
const explainArgs = z
  .object({ workflowId: z.uuid(), executionId: z.uuid() })
  .strict();

export const TOOL_SPECS: ChatToolSpec[] = [
  {
    name: 'list_workflows',
    description:
      "List the user's workflows in the current workspace (id, name, status, updatedAt; at most 50).",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'explain_run_failure',
    description:
      'Explain why one workflow run failed: run status, the failed node, its error code and message, timestamps. Needs the workflow id (from list_workflows) and the execution id.',
    parameters: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow UUID' },
        executionId: { type: 'string', description: 'Execution (run) UUID' },
      },
      required: ['workflowId', 'executionId'],
      additionalProperties: false,
    },
  },
];

const fail = (error: string): ToolOutcome => ({ ok: false, data: { error } });

export async function runTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  let json: unknown;
  try {
    json = rawArguments.trim() === '' ? {} : JSON.parse(rawArguments);
  } catch {
    return fail('invalid_arguments');
  }
  if (name === 'list_workflows') {
    if (!listArgs.safeParse(json).success) return fail('invalid_arguments');
    return get(
      ctx,
      `/workspaces/${ctx.workspaceId}/workflows?page=0&size=50`,
      projectWorkflows,
    );
  }
  if (name === 'explain_run_failure') {
    const args = explainArgs.safeParse(json);
    if (!args.success) return fail('invalid_arguments');
    return get(
      ctx,
      `/workspaces/${ctx.workspaceId}/workflows/${args.data.workflowId}/executions/${args.data.executionId}?logPage=0&logSize=1`,
      projectExecution,
    );
  }
  return fail('unknown_tool');
}

async function get(
  ctx: ToolContext,
  path: string,
  project: (body: unknown) => unknown,
): Promise<ToolOutcome> {
  try {
    const response = await (ctx.fetchImpl ?? fetch)(
      `${ctx.workflowApiUrl.replace(/\/+$/, '')}${path}`,
      {
        redirect: 'error',
        signal: AbortSignal.any([
          ctx.signal,
          AbortSignal.timeout(TOOL_TIMEOUT_MS),
        ]),
        headers: {
          authorization: ctx.authorization,
          accept: 'application/json',
        },
      },
    );
    if (response.status === 403 || response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return fail('not_found_or_forbidden');
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return fail(response.status === 401 ? 'unauthorized' : 'upstream_error');
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return fail('upstream_error');
    return { ok: true, data: project(JSON.parse(text)) };
  } catch {
    return fail('upstream_error');
  }
}

const str = (value: unknown, max = MAX_TEXT) =>
  typeof value === 'string' ? value.slice(0, max) : null;

function projectWorkflows(body: unknown): unknown {
  const items =
    isPlainObject(body) && Array.isArray(body.items) ? body.items : [];
  return {
    workflows: items.slice(0, 50).flatMap((item) =>
      isPlainObject(item)
        ? [
            {
              id: str(item.workflowId ?? item.id, 64),
              name: str(item.name, 120),
              status: str(item.status, 32),
              updatedAt: str(item.updatedAt, 40),
            },
          ]
        : [],
    ),
  };
}

function projectExecution(body: unknown): unknown {
  const run = isPlainObject(body) ? body : {};
  const nodes = Array.isArray(run.nodes) ? run.nodes.filter(isPlainObject) : [];
  const failed = nodes.find((node) => node.status === 'FAILED');
  // The contract leaves node error as any sanitized JSON: object {code, message} or a plain string.
  const error = failed && isPlainObject(failed.error) ? failed.error : {};
  const errorText =
    failed && typeof failed.error === 'string' ? failed.error : null;
  return {
    status: str(run.status, 32),
    createdAt: str(run.createdAt, 40),
    startedAt: str(run.startedAt, 40),
    finishedAt: str(run.finishedAt, 40),
    failedNode: failed
      ? {
          nodeId: str(failed.nodeId, 128),
          nodeType: str(failed.nodeType, 128),
          attemptCount:
            typeof failed.attemptCount === 'number'
              ? failed.attemptCount
              : null,
          startedAt: str(failed.startedAt, 40),
          finishedAt: str(failed.finishedAt, 40),
          errorCode: str(error.code, 128),
          errorMessage:
            errorText !== null ? str(errorText) : str(error.message),
        }
      : null,
  };
}
