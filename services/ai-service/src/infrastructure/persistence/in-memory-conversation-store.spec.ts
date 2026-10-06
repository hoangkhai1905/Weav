/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { strict as assert } from 'node:assert';
import {
  boundRecent,
  conversationTitle,
} from '../../application/assistant/conversation-store';
import { InMemoryConversationStore } from '../../../test/support/in-memory-conversation-store';
import { startRetentionPurge } from './retention-purge';

const { storeCases } = require('../../../test/support/store-cases.cjs');

describe('InMemoryConversationStore (same cases as the Postgres store)', () => {
  storeCases({
    test,
    assert,
    makeStore: () => new InMemoryConversationStore(),
  });
});

describe('conversationTitle', () => {
  it('trims and caps at 80 code points', () => {
    expect(conversationTitle('  hi there \n')).toBe('hi there');
    expect(conversationTitle('😀'.repeat(100))).toBe('😀'.repeat(80));
    expect(conversationTitle('   ')).toBe('New conversation');
  });
});

describe('boundRecent', () => {
  it('returns oldest first and keeps the latest even when too long', () => {
    const newestFirst = [{ content: 'xxxxxx' }, { content: 'y' }];
    expect(boundRecent(newestFirst, 5, 2)).toEqual([{ content: 'xxxxxx' }]);
    expect(boundRecent(newestFirst, 5, 10).map((m) => m.content)).toEqual([
      'y',
      'xxxxxx',
    ]);
  });
});

describe('startRetentionPurge', () => {
  afterEach(() => jest.useRealTimers());

  it('purges on the interval, logs failures instead of throwing, and stops', async () => {
    jest.useFakeTimers();
    const purge = jest
      .fn()
      .mockResolvedValueOnce({ conversations: 2, usageRows: 1 })
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ conversations: 0, usageRows: 0 });
    const logger = { log: jest.fn(), error: jest.fn() };
    const opts = {
      intervalMs: 1000,
      conversationRetentionDays: 30,
      usageRetentionDays: 90,
    };
    const stop = startRetentionPurge(
      { purge } as unknown as InMemoryConversationStore,
      opts,
      logger,
    );
    await jest.advanceTimersByTimeAsync(2000);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(purge).toHaveBeenCalledTimes(2);
  });
});
