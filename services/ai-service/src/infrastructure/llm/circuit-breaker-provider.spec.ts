import type {
  ChatEvent,
  ChatProvider,
} from '../../application/assistant/chat-provider';
import { AiError } from '../../domain/errors';
import {
  CircuitBreakerChatProvider,
  CircuitBreakerProvider,
} from './circuit-breaker-provider';

const req = { system: 's', user: 'u' };
const signal = new AbortController().signal;

function setup(threshold = 3) {
  let t = 0;
  const completeJson = jest.fn();
  const breaker = new CircuitBreakerProvider(
    { completeJson },
    threshold,
    30_000,
    () => t,
  );
  return {
    inner: { completeJson },
    breaker,
    advance: (ms: number) => (t += ms),
  };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e: AiError) => e.code,
  );

describe('CircuitBreakerProvider', () => {
  it('opens after N failures, fails fast, then recovers after the open period', async () => {
    const { inner, breaker, advance } = setup();
    inner.completeJson.mockRejectedValue(
      new AiError('AI_PROVIDER_UNAVAILABLE'),
    );
    for (let i = 0; i < 3; i++)
      await breaker.completeJson(req, signal).catch(() => 0);
    expect(inner.completeJson).toHaveBeenCalledTimes(3);

    expect(await code(breaker.completeJson(req, signal))).toBe(
      'AI_PROVIDER_UNAVAILABLE',
    );
    expect(inner.completeJson).toHaveBeenCalledTimes(3); // failed fast

    advance(30_000);
    inner.completeJson.mockResolvedValue({ ok: 1 });
    expect(await code(breaker.completeJson(req, signal))).toBe('OK');
    expect(await code(breaker.completeJson(req, signal))).toBe('OK');
    expect(inner.completeJson).toHaveBeenCalledTimes(5);
  });

  it('reopens when the half-open trial fails', async () => {
    const { inner, breaker, advance } = setup(1);
    inner.completeJson.mockRejectedValue(new AiError('AI_TIMEOUT'));
    await breaker.completeJson(req, signal).catch(() => 0);
    advance(30_000);
    await breaker.completeJson(req, signal).catch(() => 0); // trial
    expect(inner.completeJson).toHaveBeenCalledTimes(2);
    await breaker.completeJson(req, signal).catch(() => 0); // open again
    expect(inner.completeJson).toHaveBeenCalledTimes(2);
  });

  it('does not count a caller hang-up', async () => {
    const { inner, breaker } = setup(1);
    const aborted = new AbortController();
    aborted.abort();
    inner.completeJson.mockRejectedValue(new AiError('AI_TIMEOUT'));
    await breaker.completeJson(req, aborted.signal).catch(() => 0);
    await breaker.completeJson(req, signal).catch(() => 0);
    expect(inner.completeJson).toHaveBeenCalledTimes(2); // still closed
  });

  it('does not count output/validation errors', async () => {
    const { inner, breaker } = setup(2);
    inner.completeJson.mockRejectedValue(new AiError('AI_OUTPUT_INVALID'));
    for (let i = 0; i < 5; i++)
      await breaker.completeJson(req, signal).catch(() => 0);
    expect(inner.completeJson).toHaveBeenCalledTimes(5);
  });
});

describe('CircuitBreakerChatProvider', () => {
  const chatReq = { messages: [], maxTokens: 10 };
  const okRound: ChatEvent[] = [
    { type: 'delta', text: 'hi' },
    { type: 'end', toolCalls: [] },
  ];

  function chatSetup(threshold = 3) {
    let t = 0;
    const stream = jest.fn<AsyncGenerator<ChatEvent>, []>();
    const inner: ChatProvider = { stream };
    const breaker = new CircuitBreakerChatProvider(
      inner,
      threshold,
      30_000,
      () => t,
    );
    const failing = (error: Error, before: ChatEvent[] = []) =>
      stream.mockImplementation(async function* () {
        yield* before;
        await Promise.resolve();
        throw error;
      });
    const succeeding = () =>
      stream.mockImplementation(async function* () {
        await Promise.resolve();
        yield* okRound;
      });
    return {
      stream,
      breaker,
      failing,
      succeeding,
      advance: (ms: number) => (t += ms),
    };
  }
  const run = async (provider: ChatProvider, s: AbortSignal = signal) => {
    const events: ChatEvent[] = [];
    try {
      for await (const e of provider.stream(chatReq, s)) events.push(e);
      return { events, code: 'OK' };
    } catch (e) {
      return { events, code: (e as AiError).code };
    }
  };

  it('passes events through unchanged', async () => {
    const { breaker, succeeding } = chatSetup();
    succeeding();
    expect(await run(breaker)).toEqual({ events: okRound, code: 'OK' });
  });

  it('opens after N failed streams, fails fast, then recovers after the open period', async () => {
    const { stream, breaker, failing, succeeding, advance } = chatSetup();
    failing(new AiError('AI_PROVIDER_UNAVAILABLE'));
    for (let i = 0; i < 3; i++) await run(breaker);
    expect(stream).toHaveBeenCalledTimes(3);

    expect((await run(breaker)).code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(stream).toHaveBeenCalledTimes(3); // failed fast

    advance(30_000);
    succeeding();
    expect((await run(breaker)).code).toBe('OK');
    expect((await run(breaker)).code).toBe('OK');
    expect(stream).toHaveBeenCalledTimes(5);
  });

  it('counts a failure that happens after some text was streamed', async () => {
    const { stream, breaker, failing } = chatSetup(1);
    failing(new AiError('AI_TIMEOUT'), [{ type: 'delta', text: 'par' }]);
    expect(await run(breaker)).toEqual({
      events: [{ type: 'delta', text: 'par' }],
      code: 'AI_TIMEOUT',
    });
    await run(breaker);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('reopens when the half-open trial fails', async () => {
    const { stream, breaker, failing, advance } = chatSetup(1);
    failing(new AiError('AI_TIMEOUT'));
    await run(breaker);
    advance(30_000);
    await run(breaker); // trial
    expect(stream).toHaveBeenCalledTimes(2);
    await run(breaker); // open again
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('lets only one trial through, and an abandoned trial does not wedge the circuit', async () => {
    const { stream, breaker, failing, advance } = chatSetup(1);
    failing(new AiError('AI_TIMEOUT'));
    await run(breaker);
    advance(30_000);
    stream.mockImplementation(async function* () {
      await Promise.resolve();
      yield { type: 'delta', text: 'a' };
      yield { type: 'delta', text: 'b' };
    });
    const trial = breaker.stream(chatReq, signal);
    await trial.next(); // trial in flight
    expect((await run(breaker)).code).toBe('AI_PROVIDER_UNAVAILABLE');
    await trial.return(undefined); // consumer walks away
    // The trial slot is free again (circuit still open, so the next call is the next trial).
    expect((await run(breaker)).events).toHaveLength(2);
  });

  it('does not count a caller hang-up', async () => {
    const { stream, breaker, failing } = chatSetup(1);
    const aborted = new AbortController();
    aborted.abort();
    failing(new AiError('AI_TIMEOUT'));
    await run(breaker, aborted.signal);
    await run(breaker);
    expect(stream).toHaveBeenCalledTimes(2); // still closed
  });

  it('does not count output/auth errors', async () => {
    const { stream, breaker, failing } = chatSetup(2);
    failing(new AiError('AI_OUTPUT_INVALID'));
    for (let i = 0; i < 5; i++) await run(breaker);
    expect(stream).toHaveBeenCalledTimes(5);
  });
});
