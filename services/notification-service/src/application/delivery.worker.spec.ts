import { Logger } from '@nestjs/common';
import { DeliveryWorker, MAX_DRAIN_PER_TICK } from './delivery.worker';
import { DeliveryError } from '../domain/notification';
import {
  mockRepository,
  testDelivery,
  testSettings,
} from '../testing/fixtures';

describe('durable delivery worker', () => {
  const repo = mockRepository();
  const send = jest.fn();
  const receipt = jest.fn();
  const worker = new DeliveryWorker(repo, testSettings(), {
    TELEGRAM: { send },
    EXPO_PUSH: { send, receipt },
    EMAIL: { send },
  });
  beforeEach(() => jest.resetAllMocks());
  it('persists successful sends', async () => {
    send.mockResolvedValue({ kind: 'sent' });
    const row = testDelivery();
    await worker.deliver(row);
    expect(repo.finish).toHaveBeenCalledWith(
      row,
      expect.objectContaining({
        status: 'SENT',
        scheduledAt: null,
        sentAt: expect.any(Date) as Date,
      }),
    );
  });
  it('retries only the persistence write after the provider accepted', async () => {
    send.mockResolvedValue({ kind: 'sent' });
    repo.finish.mockRejectedValueOnce(new Error('db blip'));
    await worker.deliver(testDelivery());
    expect(send).toHaveBeenCalledTimes(1);
    expect(repo.finish).toHaveBeenCalledTimes(2);
    expect(repo.finish.mock.calls[1][1]).toMatchObject({ status: 'SENT' });
  });
  it.each([true, false])(
    'classifies retryable=%s failures',
    async (retryable) => {
      send.mockRejectedValue(new DeliveryError('PROVIDER_ERROR', retryable));
      await worker.deliver(testDelivery());
      expect(repo.finish.mock.calls[0][1]).toMatchObject({
        status: 'FAILED',
        scheduledAt: retryable ? (expect.any(Date) as Date) : null,
      });
    },
  );
  it('stops at the attempt limit', async () => {
    send.mockRejectedValue(new DeliveryError('TIMEOUT', true));
    const row = testDelivery();
    row.retryCount = 5;
    await worker.deliver(row);
    expect(repo.finish.mock.calls[0][1].scheduledAt).toBeNull();
  });
  it('persists receipt tickets and checks them after restart without resending', async () => {
    const row = testDelivery();
    row.provider = 'EXPO_PUSH';
    send.mockResolvedValue({ kind: 'receipt', id: 'ticket' });
    await worker.deliver(row);
    const payload = repo.finish.mock.calls[0][1].payload!;
    expect(payload._receiptId).toBe('ticket');
    row.payload = payload;
    receipt.mockResolvedValue({ kind: 'sent' });
    await worker.deliver(row);
    expect(send).toHaveBeenCalledTimes(1);
    expect(receipt).toHaveBeenCalledWith('ticket');
  });
  it('bounds missing-receipt polling without resending', async () => {
    const row = testDelivery();
    row.provider = 'EXPO_PUSH';
    row.payload._receiptId = 'ticket';
    row.payload._receiptSince = Date.now() - 24 * 3600000;
    await worker.deliver(row);
    expect(send).not.toHaveBeenCalled();
    expect(receipt).not.toHaveBeenCalled();
    expect(repo.finish.mock.calls[0][1]).toMatchObject({
      status: 'FAILED',
      scheduledAt: null,
    });
  });
  it.each([true, false])(
    'clears tickets only for definitive receipt rejection: %s',
    async (resend) => {
      const row = testDelivery();
      row.provider = 'EXPO_PUSH';
      row.payload._receiptId = 'ticket';
      row.payload._receiptSince = Date.now();
      receipt.mockRejectedValue(
        new DeliveryError('EXPO_RETRY', true, 0, resend),
      );
      await worker.deliver(row);
      const patch = repo.finish.mock.calls[0][1];
      expect(patch.payload?._receiptId).toBe(resend ? undefined : 'ticket');
      expect(patch.scheduledAt).not.toBeNull();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it('does not convert a database failure after send into a provider retry', async () => {
    send.mockResolvedValue({ kind: 'sent' });
    repo.finish.mockRejectedValue(new Error('database down'));
    await expect(worker.deliver(testDelivery())).rejects.toThrow(
      'database down',
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(repo.finish).toHaveBeenCalledTimes(3);
  });
  it('claims one row before dispatch', async () => {
    repo.claim.mockResolvedValue(null);
    await worker.tick();
    expect(send).not.toHaveBeenCalled();
    expect(repo.claim).toHaveBeenCalledWith(5, 60000);
  });
  it('drains several due rows in one tick and stops when the queue is empty', async () => {
    send.mockResolvedValue({ kind: 'sent' });
    repo.claim
      .mockResolvedValueOnce(testDelivery())
      .mockResolvedValueOnce(testDelivery())
      .mockResolvedValueOnce(testDelivery())
      .mockResolvedValueOnce(null);
    await expect(worker.tick()).resolves.toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect(repo.claim).toHaveBeenCalledTimes(4);
  });
  it('bounds a drain so a backlog cannot monopolise the worker', async () => {
    send.mockResolvedValue({ kind: 'sent' });
    repo.claim.mockImplementation(() => Promise.resolve(testDelivery()));
    await expect(worker.tick()).resolves.toBe(MAX_DRAIN_PER_TICK);
    expect(repo.claim).toHaveBeenCalledTimes(MAX_DRAIN_PER_TICK);
  });
  it('logs the delivery id and error class when a row fails unexpectedly, then rethrows', async () => {
    const row = testDelivery();
    repo.claim.mockResolvedValueOnce(row);
    send.mockRejectedValue(new TypeError('boom with body 12345'));
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await expect(worker.tick()).rejects.toThrow(TypeError);
    expect(log).toHaveBeenCalledWith({
      event: 'notification_delivery_unexpected_error',
      deliveryId: row.id,
      errorClass: 'TypeError',
    });
    log.mockRestore();
  });
});

describe('delivery worker idle backoff', () => {
  const repo = mockRepository();
  const providers = {
    TELEGRAM: { send: jest.fn() },
    EXPO_PUSH: { send: jest.fn() },
    EMAIL: { send: jest.fn() },
  };
  const make = (overrides = {}) => {
    const worker = new DeliveryWorker(
      repo,
      testSettings({
        NOTIFICATION_POLL_MS: 1000,
        NOTIFICATION_WORKER_IDLE_MAX_MS: 8000,
        ...overrides,
      }),
      providers,
    );
    worker.jitterMs = 0;
    return worker;
  };
  const spin = (_worker: DeliveryWorker, ms: number) =>
    jest.advanceTimersByTimeAsync(ms);
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    // Epoch 0 keeps the wall-clock alignment arithmetic readable.
    jest.setSystemTime(0);
    providers.TELEGRAM.send.mockResolvedValue({ kind: 'sent' });
  });
  afterEach(() => jest.useRealTimers());
  it('doubles the wait after each empty poll, then sleeps to the next wall-clock multiple of the cap', async () => {
    repo.claim.mockResolvedValue(null);
    const worker = make();
    worker.onModuleInit();
    expect(worker.currentDelayMs).toBe(1000);
    const seen: number[] = [];
    const wakeAt: number[] = [];
    for (let i = 0; i < 6; i++) {
      await spin(worker, worker.currentDelayMs);
      seen.push(worker.currentDelayMs);
      wakeAt.push(Date.now() + worker.currentDelayMs);
    }
    // t=7000: doubling would reach the cap, so wake at 16000 (first multiple of 8000 >= now + 4000).
    expect(seen).toEqual([2000, 4000, 9000, 8000, 8000, 8000]);
    expect(wakeAt.slice(2).every((t) => t % 8000 === 0)).toBe(true);
    await worker.onModuleDestroy();
  });
  it('stops the doubling ramp at 60 s even with a 10 minute cap', async () => {
    repo.claim.mockResolvedValue(null);
    const worker = make({ NOTIFICATION_WORKER_IDLE_MAX_MS: 600000 });
    worker.onModuleInit();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      await spin(worker, worker.currentDelayMs);
      seen.push(worker.currentDelayMs);
    }
    expect(seen.slice(0, 5)).toEqual([2000, 4000, 8000, 16000, 32000]);
    // t=63000: aligned to the next multiple of 600000 at least 300000 away.
    expect((Date.now() + seen[5]) % 600000).toBe(0);
    expect(seen[5]).toBeGreaterThanOrEqual(300000);
    await worker.onModuleDestroy();
  });
  it('adds the per-process jitter to the aligned wake only', async () => {
    repo.claim.mockResolvedValue(null);
    const worker = make();
    worker.jitterMs = 1500;
    worker.onModuleInit();
    await spin(worker, 1000);
    await spin(worker, 2000);
    expect(worker.currentDelayMs).toBe(4000);
    await spin(worker, 4000);
    expect(worker.currentDelayMs).toBe(9000 + 1500);
    await worker.onModuleDestroy();
  });
  it('keeps the default jitter within 2 seconds', () => {
    for (let i = 0; i < 20; i++) {
      const w = new DeliveryWorker(repo, testSettings(), providers);
      expect(w.jitterMs).toBeGreaterThanOrEqual(0);
      expect(w.jitterMs).toBeLessThanOrEqual(2000);
    }
  });
  it('sleeps until the earliest scheduled delivery when it is sooner than the idle wake', async () => {
    repo.claim.mockResolvedValue(null);
    repo.nextDueInMs.mockResolvedValue(1500);
    const worker = make();
    worker.onModuleInit();
    await spin(worker, 1000);
    expect(worker.currentDelayMs).toBe(1500);
    expect(repo.nextDueInMs).toHaveBeenCalledWith(5, 60000);
    // A due time beyond the aligned wake does not delay it; an overdue one floors at the poll interval.
    repo.nextDueInMs.mockResolvedValue(10 * 60000);
    await spin(worker, 1500);
    expect(worker.currentDelayMs).toBe(3000);
    repo.nextDueInMs.mockResolvedValue(-250);
    await spin(worker, 3000);
    expect(worker.currentDelayMs).toBe(1000);
    await worker.onModuleDestroy();
  });
  it('does not look up the next due time when work was found, and survives a failing lookup', async () => {
    repo.claim.mockResolvedValueOnce(testDelivery()).mockResolvedValue(null);
    repo.nextDueInMs.mockRejectedValue(new Error('db'));
    const worker = make();
    worker.onModuleInit();
    await spin(worker, 1000);
    expect(repo.nextDueInMs).not.toHaveBeenCalled();
    await spin(worker, 1000);
    expect(repo.nextDueInMs).toHaveBeenCalledTimes(1);
    expect(worker.currentDelayMs).toBe(2000);
    await worker.onModuleDestroy();
  });
  it('wake() during a running tick polls again at the base interval instead of backing off', async () => {
    let release!: () => void;
    repo.claim.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    );
    const worker = make();
    worker.onModuleInit();
    await spin(worker, 1000);
    worker.wake();
    release();
    await spin(worker, 0);
    expect(worker.currentDelayMs).toBe(1000);
    await worker.onModuleDestroy();
  });
  it('polls rarely while idle', async () => {
    repo.claim.mockResolvedValue(null);
    const worker = make();
    worker.onModuleInit();
    await spin(worker, 60000);
    // 1s + 2s + 4s + 8s*7 ... far fewer than 60 one-second polls.
    expect(repo.claim.mock.calls.length).toBeLessThan(12);
    await worker.onModuleDestroy();
  });
  it('resets to the base interval as soon as work is found', async () => {
    repo.claim.mockResolvedValue(null);
    const worker = make();
    worker.onModuleInit();
    await spin(worker, 1000);
    await spin(worker, 2000);
    expect(worker.currentDelayMs).toBe(4000);
    repo.claim.mockResolvedValueOnce(testDelivery()).mockResolvedValue(null);
    await spin(worker, 4000);
    expect(worker.currentDelayMs).toBe(1000);
    await worker.onModuleDestroy();
  });
  it('backs off after a failing poll and logs the error class only', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    repo.claim.mockRejectedValue(new Error('db down'));
    const worker = make();
    worker.onModuleInit();
    await spin(worker, 1000);
    expect(worker.currentDelayMs).toBe(2000);
    expect(log).toHaveBeenCalledWith({
      event: 'notification_worker_unavailable',
      errorClass: 'Error',
    });
    await worker.onModuleDestroy();
    log.mockRestore();
  });
  it('never waits less than the poll interval when the cap is lower', async () => {
    repo.claim.mockResolvedValue(null);
    const worker = make({
      NOTIFICATION_POLL_MS: 5000,
      NOTIFICATION_WORKER_IDLE_MAX_MS: 1000,
    });
    worker.onModuleInit();
    await spin(worker, 5000);
    expect(worker.currentDelayMs).toBe(5000);
    await worker.onModuleDestroy();
  });
  it('wake() restores the base interval and reschedules an idle wait', async () => {
    repo.claim.mockResolvedValue(null);
    const worker = make();
    worker.onModuleInit();
    await spin(worker, 1000);
    await spin(worker, 2000);
    expect(worker.currentDelayMs).toBe(4000);
    worker.wake();
    expect(worker.currentDelayMs).toBe(1000);
    const calls = repo.claim.mock.calls.length;
    await spin(worker, 1000);
    expect(repo.claim.mock.calls.length).toBe(calls + 1);
    await worker.onModuleDestroy();
  });
  it('stops draining on shutdown', async () => {
    repo.claim.mockResolvedValue(null);
    const worker = make();
    await worker.onModuleDestroy();
    repo.claim.mockImplementation(() => Promise.resolve(testDelivery()));
    await expect(worker.tick()).resolves.toBe(0);
  });
});
