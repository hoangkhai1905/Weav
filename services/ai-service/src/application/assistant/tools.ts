import { z } from 'zod';
import { isPlainObject } from '../../domain/errors';
import type { ChatToolSpec } from './chat-provider';

export interface ToolContext {
  workspaceId: string;
  /** The caller's own `Authorization: Bearer ...` header value; never a service token. */
  authorization: string;
  workflowApiUrl: string;
  /** workspace-service base URL (list_members); without it that tool answers `unavailable`. */
  workspaceApiUrl?: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Test seam for "today". */
  now?: () => Date;
}

/** `ok:false` results carry only a stable error code, never upstream text. */
export interface ToolOutcome {
  ok: boolean;
  data: unknown;
  /** Client-only payload (yielded as an SSE `draft` event); never shown to the model. */
  draft?: { name: string; definition: unknown; layout: unknown };
}

const MAX_RESPONSE_BYTES = 512 * 1024;
const TOOL_TIMEOUT_MS = 10_000;
// Below the 60 s request deadline (the first model round runs before the tool).
const GENERATE_TIMEOUT_MS = 40_000;
const MAX_RUNS = 40;
const MAX_TEXT = 300;
const FAN_OUT_CONCURRENCY = 4;
const WORKFLOW_PAGE_SIZE = 20;

const listArgs = z.object({}).strict();
const timezoneArg = z.string().min(1).max(64).optional();
const failedTodayArgs = z.object({ timezone: timezoneArg }).strict();
const buildArgs = z
  .object({ prompt: z.string().min(1).max(4000), timezone: timezoneArg })
  .strict();
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
  {
    name: 'list_failed_runs_today',
    description:
      'List runs that FAILED today (in the given timezone) across the 20 most recent workflows. Use it for "which workflows failed today". Optional IANA timezone, default UTC.',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone, e.g. Asia/Ho_Chi_Minh. Default UTC.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_members',
    description:
      'List the members of the current workspace (display name, role, permissions, join date; at most 50). No emails.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'build_workflow',
    description:
      'Turn a plain-language description into a workflow DRAFT. Nothing is saved: the user must review and save the draft in the editor. Use only when the user asks to build or create a workflow.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What the workflow should do (1-4000 chars).',
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone for schedules, e.g. Asia/Ho_Chi_Minh.',
        },
      },
      required: ['prompt'],
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
  if (name === 'list_failed_runs_today') {
    const args = failedTodayArgs.safeParse(json);
    if (!args.success) return fail('invalid_arguments');
    const day = dayKey(args.data.timezone ?? 'UTC');
    if (!day) return fail('invalid_arguments');
    return failedRunsToday(ctx, day);
  }
  if (name === 'list_members') {
    if (!listArgs.safeParse(json).success) return fail('invalid_arguments');
    if (!ctx.workspaceApiUrl) return fail('unavailable');
    return get(
      ctx,
      `/workspaces/${ctx.workspaceId}/members?page=0&size=50`,
      projectMembers,
      ctx.workspaceApiUrl,
    );
  }
  if (name === 'build_workflow') {
    const args = buildArgs.safeParse(json);
    if (!args.success) return fail('invalid_arguments');
    if (args.data.timezone && !dayKey(args.data.timezone))
      return fail('invalid_arguments');
    return buildWorkflow(ctx, args.data);
  }
  return fail('unknown_tool');
}

/** Returns `(date) => 'YYYY-MM-DD'` in the zone, or null for an invalid IANA name. */
function dayKey(timeZone: string): ((date: Date) => string) | null {
  try {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return (date) => format.format(date);
  } catch {
    return null;
  }
}

// ponytail: one request per workflow, 4 in flight; ceiling 20 workflows x 20 runs each.
// Upgrade path: a workspace-level executions endpoint in workflow-service.
async function failedRunsToday(
  ctx: ToolContext,
  day: (date: Date) => string,
): Promise<ToolOutcome> {
  const today = day((ctx.now ?? (() => new Date()))());
  const list = await call(
    ctx,
    ctx.workflowApiUrl,
    `/workspaces/${ctx.workspaceId}/workflows?page=0&size=${WORKFLOW_PAGE_SIZE}`,
  );
  if (!list.ok) return fail(list.error);
  const body = isPlainObject(list.body) ? list.body : {};
  const items = Array.isArray(body.items)
    ? body.items.filter(isPlainObject)
    : [];
  const workflows = items.slice(0, WORKFLOW_PAGE_SIZE).flatMap((item) => {
    const id = str(item.workflowId ?? item.id, 64);
    return id && z.uuid().safeParse(id).success
      ? [{ id, name: str(item.name, 120) }]
      : [];
  });
  const runs: unknown[] = [];
  let skipped = 0;
  let next = 0;
  const worker = async () => {
    while (next < workflows.length && !ctx.signal.aborted) {
      const workflow = workflows[next++];
      const page = await call(
        ctx,
        ctx.workflowApiUrl,
        `/workspaces/${ctx.workspaceId}/workflows/${workflow.id}/executions?page=0&size=20`,
      );
      if (!page.ok) {
        skipped++;
        continue;
      }
      const executions =
        isPlainObject(page.body) && Array.isArray(page.body.items)
          ? page.body.items.filter(isPlainObject)
          : [];
      for (const run of executions) {
        if (run.status !== 'FAILED') continue;
        const when = new Date(
          String(run.finishedAt ?? run.startedAt ?? run.createdAt),
        );
        if (Number.isNaN(when.getTime()) || day(when) !== today) continue;
        runs.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          executionId: str(run.executionId, 64),
          status: 'FAILED',
          startedAt: str(run.startedAt, 40),
          finishedAt: str(run.finishedAt, 40),
          // The list item has no error fields today; kept if the contract adds them.
          ...(typeof run.errorCode === 'string' && {
            errorCode: str(run.errorCode, 128),
          }),
          ...(typeof run.errorMessage === 'string' && {
            errorMessage: str(run.errorMessage),
          }),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: FAN_OUT_CONCURRENCY }, () => worker()),
  );
  // Newest first; the cap keeps the result well under the 16 KB tool-result limit.
  const stamp = (run: unknown) =>
    String((run as { finishedAt?: string }).finishedAt ?? '');
  runs.sort((a, b) => (stamp(a) < stamp(b) ? 1 : -1));
  const capped = runs.length > MAX_RUNS;
  const total = typeof body.totalElements === 'number' ? body.totalElements : 0;
  return {
    ok: true,
    data: {
      runs: runs.slice(0, MAX_RUNS),
      ...(skipped > 0 && { skippedWorkflows: skipped }),
      ...((capped || body.hasNext === true || total > WORKFLOW_PAGE_SIZE) && {
        truncated: true,
      }),
    },
  };
}

async function buildWorkflow(
  ctx: ToolContext,
  args: { prompt: string; timezone?: string },
): Promise<ToolOutcome> {
  const res = await call(
    ctx,
    ctx.workflowApiUrl,
    `/workspaces/${ctx.workspaceId}/workflows/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        prompt: args.prompt,
        ...(args.timezone && { timezone: args.timezone }),
      }),
      timeoutMs: GENERATE_TIMEOUT_MS,
    },
  );
  if (!res.ok) return fail(res.error);
  const out = isPlainObject(res.body) ? res.body : {};
  if (out.status === 'ready') {
    const name = str(out.name, 120);
    if (!name || !isPlainObject(out.definition)) return fail('upstream_error');
    const nodes = Array.isArray(out.definition.nodes)
      ? out.definition.nodes.filter(isPlainObject)
      : [];
    const nodeTypes = [
      ...new Set(nodes.flatMap((node) => str(node.type, 64) ?? [])),
    ].slice(0, 30);
    return {
      ok: true,
      data: {
        status: 'ready',
        name,
        nodeTypes,
        note: 'A draft was shown to the user. It is not saved; the user must review and save it in the editor.',
      },
      draft: { name, definition: out.definition, layout: out.layout ?? {} },
    };
  }
  const codes = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .filter(isPlainObject)
      .slice(0, 10)
      .map((item) => ({
        code: str(item.code, 64),
        field: str(item.field, 200),
      }));
  if (out.status === 'needs_input')
    return {
      ok: true,
      data: { status: 'needs_input', questions: codes(out.questions) },
    };
  if (out.status === 'unsupported')
    return {
      ok: true,
      data: { status: 'unsupported', reasons: codes(out.reasons) },
    };
  return fail('upstream_error');
}

type Upstream = { ok: true; body: unknown } | { ok: false; error: string };

async function call(
  ctx: ToolContext,
  baseUrl: string,
  path: string,
  init: { method?: 'POST'; body?: string; timeoutMs?: number } = {},
): Promise<Upstream> {
  const err = (error: string): Upstream => ({ ok: false, error });
  try {
    const response = await (ctx.fetchImpl ?? fetch)(
      `${baseUrl.replace(/\/+$/, '')}${path}`,
      {
        method: init.method ?? 'GET',
        body: init.body,
        redirect: 'error',
        signal: AbortSignal.any([
          ctx.signal,
          AbortSignal.timeout(init.timeoutMs ?? TOOL_TIMEOUT_MS),
        ]),
        headers: {
          authorization: ctx.authorization,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 403 || response.status === 404)
        return err('not_found_or_forbidden');
      if (response.status === 401) return err('unauthorized');
      if (response.status === 429) return err('rate_limited');
      if (response.status === 503) return err('unavailable');
      return err('upstream_error');
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return err('upstream_error');
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return err('upstream_error');
  }
}

async function get(
  ctx: ToolContext,
  path: string,
  project: (body: unknown) => unknown,
  baseUrl = ctx.workflowApiUrl,
): Promise<ToolOutcome> {
  const res = await call(ctx, baseUrl, path);
  return res.ok ? { ok: true, data: project(res.body) } : fail(res.error);
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

// Data minimisation: no email and no user id; only what answers "who is in this workspace".
function projectMembers(body: unknown): unknown {
  const items =
    isPlainObject(body) && Array.isArray(body.items) ? body.items : [];
  return {
    members: items.slice(0, 50).flatMap((item) =>
      isPlainObject(item)
        ? [
            {
              displayName: str(item.displayName, 120),
              role: str(item.role, 32),
              canPublishWorkflow: item.canPublishWorkflow === true,
              canManageWorkflowState: item.canManageWorkflowState === true,
              joinedAt: str(item.joinedAt, 40),
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
