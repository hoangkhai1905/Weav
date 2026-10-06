import { AiError } from '../../../domain/errors';
import { ChatEvent } from '../../../application/assistant/chat-provider';
import {
  DeepSeekChatProvider,
  ToolCallAccumulator,
} from './deepseek-chat-provider';

const config = {
  apiKey: 'k',
  model: 'm',
  baseUrl: 'https://x.test/',
  maxResponseBytes: 100_000,
};
const sse = (...chunks: unknown[]) =>
  chunks
    .map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`)
    .join('');
const delta = (d: unknown) => ({ choices: [{ delta: d }] });

/** Streams `body` in `size`-byte pieces so lines and JSON are split mid-token. */
function fetchOf(body: string, size: number, status = 200): typeof fetch {
  return (async () => {
    const bytes = new TextEncoder().encode(body);
    let at = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (at >= bytes.length) return controller.close();
          controller.enqueue(bytes.slice(at, (at += size)));
        },
      }),
      { status },
    );
  }) as typeof fetch;
}

async function collect(
  provider: DeepSeekChatProvider,
  signal = new AbortController().signal,
) {
  const events: ChatEvent[] = [];
  for await (const e of provider.stream(
    { messages: [], maxTokens: 10 },
    signal,
  ))
    events.push(e);
  return events;
}

describe('DeepSeekChatProvider', () => {
  const body =
    sse(
      delta({ role: 'assistant', content: 'Hel' }),
      delta({ content: 'lo' }),
      delta({
        tool_calls: [
          {
            index: 0,
            id: 'call_a',
            type: 'function',
            function: { name: 'list_workflows', arguments: '' },
          },
        ],
      }),
      delta({
        tool_calls: [
          {
            index: 1,
            id: 'call_b',
            function: {
              name: 'explain_run_failure',
              arguments: '{"workflowId":"w',
            },
          },
        ],
      }),
      delta({
        tool_calls: [
          { index: 1, function: { arguments: '1","executionId":"e1"}' } },
        ],
      }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }),
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ) + 'data: [DONE]\n\n';

  it.each([1, 7, 1000])(
    'assembles text and interleaved split tool calls (%i-byte chunks)',
    async (size) => {
      const events = await collect(
        new DeepSeekChatProvider(config, fetchOf(body, size)),
      );
      expect(
        events
          .filter((e) => e.type === 'delta')
          .map((e) => (e as { text: string }).text)
          .join(''),
      ).toBe('Hello');
      expect(events.at(-1)).toEqual({
        type: 'end',
        toolCalls: [
          { id: 'call_a', name: 'list_workflows', arguments: '{}' },
          {
            id: 'call_b',
            name: 'explain_run_failure',
            arguments: '{"workflowId":"w1","executionId":"e1"}',
          },
        ],
      });
    },
  );

  it('sends tools, stream:true and the bearer key, and omits tools when none are given', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response('data: [DONE]\n\n', { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new DeepSeekChatProvider(config, fetchImpl);
    const signal = new AbortController().signal;
    for await (const _ of provider.stream(
      {
        messages: [],
        maxTokens: 5,
        tools: [{ name: 't', description: 'd', parameters: {} }],
      },
      signal,
    ))
      void _;
    for await (const _ of provider.stream(
      { messages: [], maxTokens: 5 },
      signal,
    ))
      void _;
    expect(seen[0].url).toBe('https://x.test/chat/completions');
    const first = JSON.parse(seen[0].init.body as string);
    expect(first).toMatchObject({
      stream: true,
      max_tokens: 5,
      tools: [{ type: 'function', function: { name: 't' } }],
    });
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(
      'Bearer k',
    );
    expect(JSON.parse(seen[1].init.body as string).tools).toBeUndefined();
  });

  it.each([
    [401, 'AI_PROVIDER_AUTH'],
    [429, 'AI_PROVIDER_UNAVAILABLE'],
    [503, 'AI_PROVIDER_UNAVAILABLE'],
    [400, 'AI_OUTPUT_INVALID'],
  ])('maps HTTP %i to %s', async (status, code) => {
    await expect(
      collect(new DeepSeekChatProvider(config, fetchOf('', 1, status))),
    ).rejects.toMatchObject({ code });
  });

  it('rejects malformed chunks and oversize streams', async () => {
    await expect(
      collect(new DeepSeekChatProvider(config, fetchOf('data: {nope\n\n', 5))),
    ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
    const small = new DeepSeekChatProvider(
      { ...config, maxResponseBytes: 20 },
      fetchOf(body, 10),
    );
    await expect(collect(small)).rejects.toMatchObject({
      code: 'AI_OUTPUT_INVALID',
    });
  });

  it('maps an aborted request to AI_TIMEOUT and a network failure to unavailable', async () => {
    const abort = new AbortController();
    abort.abort();
    const failing = (async () => {
      throw new Error('boom');
    }) as typeof fetch;
    await expect(
      collect(new DeepSeekChatProvider(config, failing), abort.signal),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await expect(
      collect(new DeepSeekChatProvider(config, failing)),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
  });
});

describe('ToolCallAccumulator', () => {
  it('uses the call id as the slot when index is missing, keeping parallel calls apart', () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ id: 'a', function: { name: 'list_members', arguments: '{' } }]);
    acc.add([
      { id: 'b', function: { name: 'list_workflows', arguments: '{}' } },
    ]);
    acc.add([{ id: 'a', function: { arguments: '}' } }]);
    expect(acc.result()).toEqual([
      { id: 'a', name: 'list_members', arguments: '{}' },
      { id: 'b', name: 'list_workflows', arguments: '{}' },
    ]);
  });

  it('appends fragments with neither index nor id to the last slot', () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ id: 'a', function: { name: 'x', arguments: '{"k":' } }]);
    acc.add([{ function: { arguments: '1}' } }]);
    expect(acc.result()).toEqual([
      { id: 'a', name: 'x', arguments: '{"k":1}' },
    ]);
  });

  it('starts a new call when a different id arrives under the same index', () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ index: 0, id: 'a', function: { name: 'x', arguments: '{}' } }]);
    acc.add([{ index: 0, id: 'b', function: { name: 'y', arguments: '{}' } }]);
    acc.add([{ index: 0, function: { arguments: ' ' } }]);
    expect(acc.result()).toEqual([
      { id: 'a', name: 'x', arguments: '{}' },
      { id: 'b', name: 'y', arguments: '{} ' },
    ]);
  });

  it('continues an id-only first fragment with later fragments carrying neither id nor index', () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ id: 'a' }]);
    acc.add([{ function: { name: 'x', arguments: '{' } }]);
    acc.add([{ function: { arguments: '}' } }]);
    expect(acc.result()).toEqual([{ id: 'a', name: 'x', arguments: '{}' }]);
  });

  it('attaches interleaved fragments without id or index to the last slot (documented)', () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ id: 'a', function: { name: 'x', arguments: '{' } }]);
    acc.add([{ id: 'b', function: { name: 'y', arguments: '{' } }]);
    acc.add([{ function: { arguments: '}' } }]);
    expect(acc.result().map((c) => c.arguments)).toEqual(['{', '{}']);
  });

  it('keeps index-based assembly in order of first appearance', () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ index: 0, id: 'a', function: { name: 'x', arguments: '{' } }]);
    acc.add([{ index: 1, id: 'b', function: { name: 'y', arguments: '{}' } }]);
    acc.add([{ index: 0, function: { arguments: '}' } }]);
    expect(acc.result().map((c) => [c.id, c.arguments])).toEqual([
      ['a', '{}'],
      ['b', '{}'],
    ]);
  });

  it('rejects absurd indexes and oversized arguments', () => {
    const acc = new ToolCallAccumulator();
    expect(() => acc.add([{ index: 99 }])).toThrow(AiError);
    expect(() =>
      acc.add([{ index: 0, function: { arguments: 'x'.repeat(9000) } }]),
    ).toThrow(AiError);
  });
});
