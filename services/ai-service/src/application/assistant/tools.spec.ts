import { runTool, ToolContext } from './tools';

const WS = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const wfId = (n: number) =>
  `4fa85f64-5717-4562-b3fc-2c963f66af${String(n).padStart(2, '0')}`;
// 2026-10-07 03:00 in Asia/Ho_Chi_Minh, still 2026-10-06 in UTC.
const NOW = new Date('2026-10-06T20:00:00Z');

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function ctx(handler: Handler, extra: Partial<ToolContext> = {}) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  const context: ToolContext = {
    workspaceId: WS,
    authorization: 'Bearer user-token',
    workflowApiUrl: 'http://wf',
    workspaceApiUrl: 'http://ws',
    signal: new AbortController().signal,
    fetchImpl,
    now: () => NOW,
    ...extra,
  };
  return { seen, context };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const dataOf = async (name: string, args: string, handler: Handler) =>
  (await runTool(name, args, ctx(handler).context)).data;

describe('list_members', () => {
  it('projects names and roles only: no email, no user id, extra fields dropped', async () => {
    const { seen, context } = ctx(() =>
      json({
        items: [
          {
            userId: 'u1',
            email: 'a@b.test',
            displayName: 'A'.repeat(200),
            role: 'OWNER',
            canPublishWorkflow: true,
            canManageWorkflowState: false,
            joinedAt: '2026-01-01T00:00:00Z',
            updatedAt: 'x',
            active: true,
          },
        ],
      }),
    );
    const out = await runTool('list_members', '{}', context);
    expect(seen[0].url).toBe(
      `http://ws/workspaces/${WS}/members?page=0&size=50`,
    );
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(
      'Bearer user-token',
    );
    expect(out).toEqual({
      ok: true,
      data: {
        members: [
          {
            displayName: 'A'.repeat(120),
            role: 'OWNER',
            canPublishWorkflow: true,
            canManageWorkflowState: false,
            joinedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/a@b\.test|u1/);
  });

  it('rejects arguments and maps upstream errors without upstream text', async () => {
    expect(await dataOf('list_members', '{"x":1}', () => json({}))).toEqual({
      error: 'invalid_arguments',
    });
    expect(await dataOf('list_members', '{}', () => json({}, 403))).toEqual({
      error: 'not_found_or_forbidden',
    });
    expect(
      await dataOf('list_members', '{}', () => json({ m: 'secret' }, 500)),
    ).toEqual({ error: 'upstream_error' });
  });

  it('is unavailable when no workspace API url is wired', async () => {
    const { context } = ctx(() => json({}), { workspaceApiUrl: undefined });
    expect((await runTool('list_members', '{}', context)).data).toEqual({
      error: 'unavailable',
    });
  });
});

describe('list_failed_runs_today', () => {
  const workflows = (count: number, extra: object = {}) =>
    json({
      items: Array.from({ length: count }, (_, i) => ({
        workflowId: wfId(i),
        name: `wf${i}`,
      })),
      ...extra,
    });
  const ids = (out: { data: unknown }) =>
    (out.data as { runs: { executionId: string }[] }).runs.map(
      (r) => r.executionId,
    );

  it('keeps FAILED runs of today in the caller timezone (day boundary)', async () => {
    const { context } = ctx((url) =>
      url.includes('/executions')
        ? json({
            items: [
              // Oct 7 01:30 in Ho Chi Minh, Oct 6 in UTC.
              {
                executionId: 'e1',
                status: 'FAILED',
                createdAt: '2026-10-06T18:00:00Z',
                finishedAt: '2026-10-06T18:30:00Z',
              },
              // Oct 6 23:59 in Ho Chi Minh: already yesterday there.
              {
                executionId: 'e2',
                status: 'FAILED',
                createdAt: '2026-10-06T16:59:00Z',
                finishedAt: '2026-10-06T16:59:30Z',
              },
              {
                executionId: 'e3',
                status: 'SUCCESS',
                createdAt: '2026-10-06T19:00:00Z',
              },
            ],
          })
        : workflows(1),
    );
    const hcm = await runTool(
      'list_failed_runs_today',
      '{"timezone":"Asia/Ho_Chi_Minh"}',
      context,
    );
    expect(ids(hcm)).toEqual(['e1']);
    const utc = await runTool('list_failed_runs_today', '{}', context);
    expect(ids(utc)).toEqual(['e1', 'e2']);
    expect((utc.data as { runs: unknown[] }).runs[0]).toMatchObject({
      workflowId: wfId(0),
      workflowName: 'wf0',
      status: 'FAILED',
    });
  });

  it('rejects an invalid timezone before any request', async () => {
    const { seen, context } = ctx(() => workflows(0));
    const out = await runTool(
      'list_failed_runs_today',
      '{"timezone":"Mars/Base"}',
      context,
    );
    expect(out).toEqual({ ok: false, data: { error: 'invalid_arguments' } });
    expect(seen).toHaveLength(0);
  });

  it('caps fan-out at 4 in flight and flags truncated beyond 20 workflows', async () => {
    let inFlight = 0;
    let peak = 0;
    const { seen, context } = ctx(async (url) => {
      if (!url.includes('/executions'))
        return workflows(20, { totalElements: 35, hasNext: true });
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json({ items: [] });
    });
    const out = await runTool('list_failed_runs_today', '{}', context);
    expect(out.data).toEqual({ runs: [], truncated: true });
    expect(seen[0].url).toBe(
      `http://wf/workspaces/${WS}/workflows?page=0&size=20`,
    );
    expect(seen[1].url).toContain('/executions?page=0&size=20');
    expect(seen).toHaveLength(21);
    expect(peak).toBe(4);
  });

  it('counts workflows whose runs could not be read instead of failing', async () => {
    expect(
      await dataOf('list_failed_runs_today', '{}', (url) =>
        url.includes('/executions') ? json({}, 500) : workflows(2),
      ),
    ).toEqual({ runs: [], skippedWorkflows: 2 });
  });

  it('caps runs at 40, newest first, and flags truncated', async () => {
    const out = await dataOf('list_failed_runs_today', '{}', (url) =>
      url.includes('/executions')
        ? json({
            items: Array.from({ length: 20 }, (_, i) => ({
              executionId: `e${i}`,
              status: 'FAILED',
              finishedAt: `2026-10-06T10:${String(i).padStart(2, '0')}:00Z`,
            })),
          })
        : workflows(3),
    );
    const { runs, truncated } = out as {
      runs: { finishedAt: string }[];
      truncated: boolean;
    };
    expect(runs).toHaveLength(40);
    expect(truncated).toBe(true);
    expect(runs[0].finishedAt >= runs[39].finishedAt).toBe(true);
  });

  it('maps a failing workflow list to a stable error', async () => {
    expect(
      await dataOf('list_failed_runs_today', '{}', () => json({}, 404)),
    ).toEqual({ error: 'not_found_or_forbidden' });
  });
});

describe('build_workflow', () => {
  const ready = {
    status: 'ready',
    name: 'Daily digest',
    definition: {
      nodes: [
        { id: 'n1', type: 'trigger.schedule' },
        { id: 'n2', type: 'ai.summarize' },
        { id: 'n3', type: 'ai.summarize' },
      ],
    },
    layout: { n1: { x: 0, y: 0 } },
  };

  it('ready: posts the prompt with the user token; model gets a summary, the client gets the draft', async () => {
    const { seen, context } = ctx(() => json(ready));
    const out = await runTool(
      'build_workflow',
      JSON.stringify({ prompt: 'digest', timezone: 'UTC' }),
      context,
    );
    expect(seen[0].url).toBe(`http://wf/workspaces/${WS}/workflows/generate`);
    expect(seen[0].init.method).toBe('POST');
    expect(JSON.parse(seen[0].init.body as string)).toEqual({
      prompt: 'digest',
      timezone: 'UTC',
    });
    expect(out.ok).toBe(true);
    expect(out.draft).toEqual({
      name: 'Daily digest',
      definition: ready.definition,
      layout: ready.layout,
    });
    expect(out.data).toMatchObject({
      status: 'ready',
      name: 'Daily digest',
      nodeTypes: ['trigger.schedule', 'ai.summarize'],
    });
    expect(JSON.stringify(out.data)).not.toContain('"definition"');
  });

  it('needs_input / unsupported give the model codes and fields only, no draft', async () => {
    const needs = await runTool(
      'build_workflow',
      '{"prompt":"x"}',
      ctx(() =>
        json({
          status: 'needs_input',
          questions: [{ code: 'CONNECTION', field: 'email.send', junk: 1 }],
        }),
      ).context,
    );
    expect(needs).toEqual({
      ok: true,
      data: {
        status: 'needs_input',
        questions: [{ code: 'CONNECTION', field: 'email.send' }],
      },
    });
    const unsupported = await runTool(
      'build_workflow',
      '{"prompt":"x"}',
      ctx(() =>
        json({ status: 'unsupported', reasons: [{ code: 'NO_TRIGGER' }] }),
      ).context,
    );
    expect(unsupported.draft).toBeUndefined();
    expect(unsupported.data).toMatchObject({
      status: 'unsupported',
      reasons: [{ code: 'NO_TRIGGER' }],
    });
  });

  it('maps 429, 503 and others, and validates arguments before any request', async () => {
    const args = '{"prompt":"x"}';
    expect(await dataOf('build_workflow', args, () => json({}, 429))).toEqual({
      error: 'rate_limited',
    });
    expect(await dataOf('build_workflow', args, () => json({}, 503))).toEqual({
      error: 'unavailable',
    });
    expect(await dataOf('build_workflow', args, () => json({}, 500))).toEqual({
      error: 'upstream_error',
    });
    const { seen, context } = ctx(() => json(ready));
    for (const bad of [
      '{}',
      '{"prompt":""}',
      `{"prompt":"${'x'.repeat(4001)}"}`,
      '{"prompt":"x","timezone":"Nope/Zone"}',
      '{"prompt":"x","extra":1}',
    ])
      expect((await runTool('build_workflow', bad, context)).data).toEqual({
        error: 'invalid_arguments',
      });
    expect(seen).toHaveLength(0);
  });
});
