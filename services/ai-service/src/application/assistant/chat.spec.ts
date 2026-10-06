import { AiError } from '../../domain/errors';
import {
  call,
  end,
  ScriptedChatProvider,
  text,
} from '../../../test/support/scripted-chat-provider';
import { AssistantEvent, MAX_TOOL_ROUNDS, runAssistant } from './chat';

const WS = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const WF = '4fa85f64-5717-4562-b3fc-2c963f66afa6';
const EX = '5fa85f64-5717-4562-b3fc-2c963f66afa6';

interface Seen {
  url: string;
  authorization: string;
}
function setup(
  responses: Record<string, { status: number; body?: unknown }> = {},
) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({
      url,
      authorization: (init.headers as Record<string, string>).authorization,
    });
    const hit = Object.entries(responses).find(([k]) =>
      url.includes(k),
    )?.[1] ?? { status: 404 };
    return new Response(
      hit.body === undefined ? null : JSON.stringify(hit.body),
      { status: hit.status },
    );
  }) as unknown as typeof fetch;
  const input = (signal = new AbortController().signal) => ({
    messages: [{ role: 'user' as const, content: 'hi' }],
    maxTokens: 100,
    tools: {
      workspaceId: WS,
      authorization: 'Bearer user-token',
      workflowApiUrl: 'http://wf',
      signal,
      fetchImpl,
    },
  });
  return { seen, input };
}
async function run(
  provider: ScriptedChatProvider,
  input: ReturnType<ReturnType<typeof setup>['input']>,
) {
  const out: AssistantEvent[] = [];
  for await (const e of runAssistant(provider, input, input.tools.signal))
    out.push(e);
  return out;
}
const toolMessages = (p: ScriptedChatProvider, request: number) =>
  p.requests[request].messages
    .filter((m) => m.role === 'tool')
    .map((m) => JSON.parse((m as { content: string }).content));

describe('runAssistant', () => {
  it('plain answer: deltas then done, tools offered', async () => {
    const p = new ScriptedChatProvider([[text('Hi '), text('there'), end()]]);
    const out = await run(p, setup().input());
    expect(out).toEqual([
      { event: 'delta', data: { text: 'Hi ' } },
      { event: 'delta', data: { text: 'there' } },
      { event: 'done', data: {} },
    ]);
    expect(p.requests[0].tools?.map((t) => t.name)).toEqual([
      'list_workflows',
      'explain_run_failure',
      'list_failed_runs_today',
      'list_members',
      'build_workflow',
    ]);
    expect(p.requests[0].messages[0].role).toBe('system');
  });

  it('two rounds: tool call, tool result as untrusted JSON, then the final answer', async () => {
    const { seen, input } = setup({
      '/workflows?': {
        status: 200,
        body: {
          items: [
            {
              workflowId: WF,
              name: 'Daily',
              status: 'PUBLISHED',
              updatedAt: 'u',
              definition: { secret: 1 },
            },
          ],
        },
      },
      [`/executions/${EX}`]: {
        status: 200,
        body: {
          status: 'FAILED',
          createdAt: 'c',
          nodes: [
            {
              nodeId: 'n1',
              nodeType: 'action.http',
              status: 'FAILED',
              attemptCount: 2,
              output: { leak: 1 },
              error: { code: 'HTTP_500', message: 'boom', stack: 'x' },
            },
          ],
        },
      },
    });
    const p = new ScriptedChatProvider([
      [end(call('c1', 'list_workflows', ''))],
      [
        text('Looking'),
        end(
          call('c2', 'explain_run_failure', {
            workflowId: WF,
            executionId: EX,
          }),
        ),
      ],
      [text('It failed.'), end()],
    ]);
    const out = await run(p, input());
    expect(out.map((e) => e.event)).toEqual([
      'tool_call',
      'tool_result',
      'delta',
      'tool_call',
      'tool_result',
      'delta',
      'done',
    ]);
    expect(out[1]).toEqual({
      event: 'tool_result',
      data: { name: 'list_workflows', ok: true },
    });
    expect(seen.every((s) => s.authorization === 'Bearer user-token')).toBe(
      true,
    );
    expect(seen[0].url).toBe(
      `http://wf/workspaces/${WS}/workflows?page=0&size=50`,
    );
    expect(toolMessages(p, 1)[0]).toEqual({
      untrusted_data: {
        workflows: [
          { id: WF, name: 'Daily', status: 'PUBLISHED', updatedAt: 'u' },
        ],
      },
    });
    const failure = toolMessages(p, 2)[1].untrusted_data;
    expect(failure.failedNode).toMatchObject({
      nodeId: 'n1',
      errorCode: 'HTTP_500',
      errorMessage: 'boom',
    });
    expect(JSON.stringify(failure)).not.toMatch(/leak|stack/);
    expect(p.requests[1].messages.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'c1' }],
    });
  });

  it(`stops offering tools after ${MAX_TOOL_ROUNDS} tool rounds`, async () => {
    const again = [end(call('c', 'list_workflows', {}))];
    const p = new ScriptedChatProvider([
      again,
      again,
      again,
      [text('final'), end(call('c', 'list_workflows', {}))],
    ]);
    const out = await run(
      p,
      setup({ '/workflows?': { status: 200, body: { items: [] } } }).input(),
    );
    expect(p.requests).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(p.requests.map((r) => Boolean(r.tools))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(out.at(-1)).toEqual({ event: 'done', data: {} });
    expect(out.filter((e) => e.event === 'tool_call')).toHaveLength(
      MAX_TOOL_ROUNDS,
    );
  });

  it.each([403, 404])(
    'maps upstream %i to not_found_or_forbidden',
    async (status) => {
      const p = new ScriptedChatProvider([
        [
          end(
            call('c', 'explain_run_failure', {
              workflowId: WF,
              executionId: EX,
            }),
          ),
        ],
        [text('x'), end()],
      ]);
      const out = await run(p, setup({ '/executions/': { status } }).input());
      expect(out[1]).toEqual({
        event: 'tool_result',
        data: { name: 'explain_run_failure', ok: false },
      });
      expect(toolMessages(p, 1)[0]).toEqual({
        untrusted_data: { error: 'not_found_or_forbidden' },
      });
    },
  );

  it('maps a string node error to errorMessage', async () => {
    const p = new ScriptedChatProvider([
      [
        end(
          call('c', 'explain_run_failure', { workflowId: WF, executionId: EX }),
        ),
      ],
      [end()],
    ]);
    await run(
      p,
      setup({
        '/executions/': {
          status: 200,
          body: {
            status: 'FAILED',
            nodes: [
              {
                nodeId: 'n1',
                nodeType: 't',
                status: 'FAILED',
                error: 'plain failure',
              },
            ],
          },
        },
      }).input(),
    );
    expect(toolMessages(p, 1)[0].untrusted_data.failedNode).toMatchObject({
      nodeId: 'n1',
      errorMessage: 'plain failure',
    });
  });

  it('maps upstream 5xx to upstream_error without upstream text', async () => {
    const p = new ScriptedChatProvider([
      [end(call('c', 'list_workflows', {}))],
      [end()],
    ]);
    await run(
      p,
      setup({
        '/workflows?': { status: 500, body: { message: 'SQL leak' } },
      }).input(),
    );
    expect(JSON.stringify(toolMessages(p, 1))).not.toMatch(/SQL/);
    expect(toolMessages(p, 1)[0]).toEqual({
      untrusted_data: { error: 'upstream_error' },
    });
  });

  it('answers unknown tool names and invalid arguments with an error result and never fetches', async () => {
    const { seen, input } = setup();
    const p = new ScriptedChatProvider([
      [
        end(
          call('a', 'delete_everything', {}),
          call('b', 'explain_run_failure', {
            workflowId: '../../internal',
            executionId: EX,
          }),
          call('c', 'explain_run_failure', '{not json'),
          call('d', 'list_workflows', { extra: 1 }),
        ),
      ],
      [end()],
    ]);
    const out = await run(p, input());
    expect(
      out
        .filter((e) => e.event === 'tool_result')
        .map((e) => (e as { data: { ok: boolean } }).data.ok),
    ).toEqual([false, false, false, false]);
    expect(toolMessages(p, 1).map((m) => m.untrusted_data.error)).toEqual([
      'unknown_tool',
      'invalid_arguments',
      'invalid_arguments',
      'invalid_arguments',
    ]);
    expect(seen).toHaveLength(0);
  });

  it('propagates provider errors and stops after an abort during a tool', async () => {
    const p = new ScriptedChatProvider([
      new AiError('AI_PROVIDER_UNAVAILABLE'),
    ]);
    await expect(run(p, setup().input())).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    const abort = new AbortController();
    const q = new ScriptedChatProvider([
      [end(call('c', 'list_workflows', {}))],
      [text('never'), end()],
    ]);
    const { input } = setup({
      '/workflows?': { status: 200, body: { items: [] } },
    });
    const iterator = runAssistant(q, input(abort.signal), abort.signal);
    expect((await iterator.next()).value).toMatchObject({ event: 'tool_call' });
    abort.abort();
    expect((await iterator.next()).done).toBe(true);
    expect(q.requests).toHaveLength(1);
  });

  it('replaces an oversized tool result with valid JSON instead of cutting it', async () => {
    const { input } = setup({
      '/workflows?': {
        status: 200,
        body: {
          items: Array.from({ length: 50 }, (_, i) => ({
            workflowId: WF,
            name: '"'.repeat(120),
            status: 'PUBLISHED',
            updatedAt: 'u'.repeat(40),
          })),
        },
      },
    });
    const p = new ScriptedChatProvider([
      [end(call('c1', 'list_workflows', {}))],
      [text('ok'), end()],
    ]);
    await run(p, input());
    expect(toolMessages(p, 1)).toEqual([
      { untrusted_data: { error: 'result_too_large' } },
    ]);
  });

  it('build_workflow: draft event goes to the client only; the model gets the summary', async () => {
    const draft = {
      name: 'D',
      definition: { nodes: [{ type: 'trigger.manual' }] },
      layout: {},
    };
    const { input } = setup({
      '/workflows/generate': {
        status: 200,
        body: { status: 'ready', ...draft },
      },
    });
    const p = new ScriptedChatProvider([
      [end(call('c1', 'build_workflow', { prompt: 'make one' }))],
      [text('Draft ready.'), end()],
    ]);
    const out = await run(p, input());
    expect(out.map((e) => e.event)).toEqual([
      'tool_call',
      'tool_result',
      'draft',
      'delta',
      'done',
    ]);
    expect(out[1]).toEqual({
      event: 'tool_result',
      data: { name: 'build_workflow', ok: true },
    });
    expect(out[2]).toEqual({ event: 'draft', data: draft });
    const [result] = toolMessages(p, 1);
    expect(result.untrusted_data).toMatchObject({
      status: 'ready',
      name: 'D',
      nodeTypes: ['trigger.manual'],
    });
    expect(JSON.stringify(result)).not.toContain('layout');
  });
});
