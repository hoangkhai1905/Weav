import { RequestDedup } from './request-dedup';

describe('RequestDedup', () => {
  it('runs concurrent duplicates once', async () => {
    const dedup = new RequestDedup<number>();
    const work = jest.fn(
      () => new Promise<number>((r) => setTimeout(() => r(7), 10)),
    );
    await expect(
      Promise.all([dedup.run('k', work), dedup.run('k', work)]),
    ).resolves.toEqual([7, 7]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('serves a repeat within the TTL from cache, then expires', async () => {
    let now = 0;
    const dedup = new RequestDedup<number>(1000, 10, () => now);
    const work = jest.fn(() => Promise.resolve(1));
    await dedup.run('k', work);
    await dedup.run('k', work);
    expect(work).toHaveBeenCalledTimes(1);
    now = 1001;
    await dedup.run('k', work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const dedup = new RequestDedup<number>();
    const work = jest
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(2);
    await expect(dedup.run('k', work)).rejects.toThrow('x');
    await expect(dedup.run('k', work)).resolves.toBe(2);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry past the size cap', async () => {
    const dedup = new RequestDedup<number>(1000, 2);
    const work = jest.fn(() => Promise.resolve(1));
    for (const k of ['a', 'b', 'c']) await dedup.run(k, work);
    await dedup.run('a', work); // evicted -> recomputed
    expect(work).toHaveBeenCalledTimes(4);
  });
});
