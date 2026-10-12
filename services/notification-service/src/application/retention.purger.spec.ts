import { RetentionPurger, RETENTION_BATCH_SIZE } from './retention.purger';
import type { RetentionRepository } from './retention.purger';
import { testSettings } from '../testing/fixtures';

describe('retention purger', () => {
  const purgeDeliveries = jest.fn<Promise<number | null>, [number, number]>();
  const purgeInbox = jest.fn<Promise<number | null>, [number, number]>();
  const repo: RetentionRepository = { purgeDeliveries, purgeInbox };
  const make = (days = 90) =>
    new RetentionPurger(
      repo,
      testSettings({ NOTIFICATION_RETENTION_DAYS: days }),
    );
  beforeEach(() => {
    jest.resetAllMocks();
    purgeDeliveries.mockResolvedValue(0);
    purgeInbox.mockResolvedValue(0);
  });
  it('batches until a short batch, deliveries before inbox', async () => {
    purgeDeliveries
      .mockResolvedValueOnce(RETENTION_BATCH_SIZE)
      .mockResolvedValueOnce(RETENTION_BATCH_SIZE)
      .mockResolvedValueOnce(17);
    purgeInbox.mockResolvedValueOnce(5);
    const summary = await make().runOnce();
    expect(summary).toEqual({ skipped: false, deliveries: 2017, inbox: 5 });
    expect(purgeDeliveries).toHaveBeenCalledTimes(3);
    expect(purgeDeliveries).toHaveBeenCalledWith(90, RETENTION_BATCH_SIZE);
    expect(purgeInbox).toHaveBeenCalledWith(90, RETENTION_BATCH_SIZE);
    const lastDelivery = Math.max(...purgeDeliveries.mock.invocationCallOrder);
    expect(Math.min(...purgeInbox.mock.invocationCallOrder)).toBeGreaterThan(
      lastDelivery,
    );
  });
  it('runs one query per table when nothing is due', async () => {
    await make().runOnce();
    expect(purgeDeliveries).toHaveBeenCalledTimes(1);
    expect(purgeInbox).toHaveBeenCalledTimes(1);
  });
  it('skips everything, inbox included, when another instance holds the lock', async () => {
    purgeDeliveries.mockResolvedValue(null);
    const summary = await make().runOnce();
    expect(summary.skipped).toBe(true);
    expect(purgeInbox).not.toHaveBeenCalled();
  });
  it('stops the inbox loop when the lock is lost mid-run', async () => {
    purgeInbox
      .mockResolvedValueOnce(RETENTION_BATCH_SIZE)
      .mockResolvedValueOnce(null);
    const summary = await make().runOnce();
    expect(summary).toEqual({ skipped: true, deliveries: 0, inbox: 1000 });
  });
  it('is single-flight within the process', async () => {
    let release!: (n: number) => void;
    purgeDeliveries.mockImplementationOnce(
      () => new Promise<number>((r) => (release = r)),
    );
    const purger = make();
    const first = purger.runOnce();
    await expect(purger.runOnce()).resolves.toMatchObject({ skipped: true });
    release(0);
    await first;
    expect(purgeDeliveries).toHaveBeenCalledTimes(1);
    await purger.runOnce();
    expect(purgeDeliveries).toHaveBeenCalledTimes(2);
  });
  it('never throws and does not purge inbox after a delivery failure', async () => {
    purgeDeliveries.mockRejectedValue(new Error('db'));
    await expect(make().runOnce()).resolves.toMatchObject({ deliveries: 0 });
    expect(purgeInbox).not.toHaveBeenCalled();
  });
  it('is disabled when retention days is 0', async () => {
    const purger = make(0);
    jest.useFakeTimers();
    purger.onModuleInit();
    await jest.advanceTimersByTimeAsync(2 * 3_600_000);
    jest.useRealTimers();
    expect((await purger.runOnce()).skipped).toBe(true);
    expect(purgeDeliveries).not.toHaveBeenCalled();
  });
  it('runs after the first delay and then hourly', async () => {
    jest.useFakeTimers();
    const purger = make();
    purger.onModuleInit();
    await jest.advanceTimersByTimeAsync(59_000);
    expect(purgeDeliveries).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(purgeDeliveries).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(purgeDeliveries).toHaveBeenCalledTimes(2);
    await purger.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(7_200_000);
    expect(purgeDeliveries).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
