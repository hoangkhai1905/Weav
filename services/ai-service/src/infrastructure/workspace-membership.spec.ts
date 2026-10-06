import { WorkspaceMembership } from './workspace-membership';

const USER = 'u1';
const WS = 'w1';

function setup(status: number | Error = 200) {
  let t = 1_000_000;
  const calls: { url: string; auth: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      auth: (init.headers as Record<string, string>).authorization,
    });
    if (status instanceof Error) throw status;
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return {
    m: new WorkspaceMembership('http://ws', fetchImpl, () => t),
    calls,
    advance: (ms: number) => (t += ms),
  };
}

describe('WorkspaceMembership', () => {
  it('accepts a member, calls the workspace route with the caller token and caches for 60 s', async () => {
    const { m, calls, advance } = setup();
    await m.assertMember(USER, WS, 'Bearer t');
    await m.assertMember(USER, WS, 'Bearer t');
    expect(calls).toEqual([
      { url: 'http://ws/workspaces/w1', auth: 'Bearer t' },
    ]);
    advance(61_000);
    await m.assertMember(USER, WS, 'Bearer t');
    expect(calls).toHaveLength(2);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'NOT_FOUND'],
    [404, 'NOT_FOUND'],
    [500, 'AI_UNAVAILABLE'],
    [302, 'AI_UNAVAILABLE'],
  ])('maps %i to %s and does not cache it', async (status, code) => {
    const { m, calls } = setup(status);
    for (let i = 0; i < 2; i++)
      await expect(m.assertMember(USER, WS, 'Bearer t')).rejects.toMatchObject({
        code,
      });
    expect(calls).toHaveLength(2);
  });

  it('maps a network failure or timeout to AI_UNAVAILABLE', async () => {
    const { m } = setup(new Error('timeout'));
    await expect(m.assertMember(USER, WS, 'Bearer t')).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
    });
  });

  it('keeps the cache bounded', async () => {
    const { m, calls } = setup();
    for (let i = 0; i < 1001; i++)
      await m.assertMember(USER, `w${i}`, 'Bearer t');
    // The oldest entry (w0) was evicted, the newest is still cached.
    await m.assertMember(USER, 'w1000', 'Bearer t');
    expect(calls).toHaveLength(1001);
    await m.assertMember(USER, 'w0', 'Bearer t');
    expect(calls).toHaveLength(1002);
  });
});
