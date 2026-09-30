require('../../../test-support/register-typescript.cjs');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MockNotificationRepository } = require('./mock-notification.repository.ts');

test('keeps mock read state isolated by account', async () => {
  const repository = new MockNotificationRepository();
  const accountA = { userId: 'mock-isolation-a', generation: 1 };
  const accountB = { userId: 'mock-isolation-b', generation: 1 };
  assert.equal(await repository.getUnreadCount(accountA), 2);
  assert.equal(await repository.getUnreadCount(accountB), 2);

  const item = (await repository.getNotificationPage(accountA, { locale: 'en' })).items[0];
  await repository.markRead(item.id, accountA, 'en');
  assert.equal(await repository.getUnreadCount(accountA), 1);
  assert.equal(await repository.getUnreadCount(accountB), 2);
});
