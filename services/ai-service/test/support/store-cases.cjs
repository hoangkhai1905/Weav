/* Behaviour cases shared by the in-memory fake (jest) and the Prisma store (node:test + real Postgres). */
const { randomUUID } = require('node:crypto');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = () => ({ userId: randomUUID(), workspaceId: randomUUID() });

/** `test(name, fn)` is jest's or node:test's; `makeStore()` returns a ConversationStore. */
function storeCases({ test, assert, makeStore }) {
  const create = (store, who, title = 't') =>
    store.createConversation({ ...who, title });

  test('owner check: only the owner can read a conversation', async () => {
    const store = makeStore();
    const me = ids();
    const { id } = await create(store, me, 'hello');
    const got = await store.getConversation(id, me.userId);
    assert.equal(got.title, 'hello');
    assert.equal(got.workspaceId, me.workspaceId);
    assert.equal(await store.getConversation(id, randomUUID()), null);
    assert.equal(await store.getConversation(randomUUID(), me.userId), null);
    assert.equal(await store.getConversation('not-a-uuid', me.userId), null);
  });

  test('list: newest first, scoped to user and workspace, paged by before', async () => {
    const store = makeStore();
    const me = ids();
    const a = await create(store, me, 'a');
    await sleep(5);
    const b = await create(store, me, 'b');
    await create(store, { ...me, workspaceId: randomUUID() }, 'other-ws');
    await create(store, { ...me, userId: randomUUID() }, 'other-user');
    await sleep(5);
    await store.appendMessages(a.id, me.userId, [{ role: 'user', content: 'bump' }]);

    const all = await store.listConversations(me.userId, me.workspaceId, { limit: 10 });
    assert.deepEqual(all.map((c) => c.id), [a.id, b.id]);
    const older = await store.listConversations(me.userId, me.workspaceId, {
      limit: 10,
      before: all[0].updatedAt,
    });
    assert.deepEqual(older.map((c) => c.id), [b.id]);
    const one = await store.listConversations(me.userId, me.workspaceId, { limit: 0 });
    assert.equal(one.length, 1);
    for (let i = 0; i < 52; i++) await create(store, me);
    const capped = await store.listConversations(me.userId, me.workspaceId, { limit: 500 });
    assert.equal(capped.length, 50);
  });

  test('appendMessages: bumps updated_at, keeps order, rejects bad input', async () => {
    const store = makeStore();
    const me = ids();
    const { id } = await create(store, me);
    const before = (await store.getConversation(id, me.userId)).updatedAt;
    await sleep(5);
    await store.appendMessages(id, me.userId, [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
    await sleep(5);
    await store.appendMessages(id, me.userId, [{ role: 'user', content: 'q2' }]);
    await store.appendMessages(id, me.userId, []);
    const after = (await store.getConversation(id, me.userId)).updatedAt;
    assert.ok(after > before);
    const rows = await store.recentMessages(id, me.userId, { maxMessages: 10, maxChars: 1000 });
    assert.deepEqual(rows.map((m) => `${m.role}:${m.content}`), ['user:q1', 'assistant:a1', 'user:q2']);

    await assert.rejects(store.appendMessages(id, me.userId, [{ role: 'user', content: 'x'.repeat(16001) }]));
    await store.appendMessages(id, me.userId, [{ role: 'user', content: 'x'.repeat(16000) }]);
    await assert.rejects(store.appendMessages(id, me.userId, [{ role: 'system', content: 'no' }]));
    await assert.rejects(store.appendMessages(id, me.userId, [{ role: 'user', content: 'a\u0000b' }]));
    await assert.rejects(store.appendMessages(randomUUID(), me.userId, [{ role: 'user', content: 'orphan' }]));
    // A rejected batch stores nothing.
    const total = await store.recentMessages(id, me.userId, { maxMessages: 50, maxChars: 1_000_000 });
    assert.equal(total.length, 4);
  });

  test('another user can neither read nor append', async () => {
    const store = makeStore();
    const me = ids();
    const other = randomUUID();
    const { id } = await create(store, me);
    await store.appendMessages(id, me.userId, [{ role: 'user', content: 'mine' }]);
    await assert.rejects(store.appendMessages(id, other, [{ role: 'user', content: 'intruder' }]));
    assert.deepEqual(await store.recentMessages(id, other, { maxMessages: 10, maxChars: 1000 }), []);
    const rows = await store.recentMessages(id, me.userId, { maxMessages: 10, maxChars: 1000 });
    assert.deepEqual(rows.map((m) => m.content), ['mine']);
  });

  test('rejects malformed conversation and usage input', async () => {
    const store = makeStore();
    const me = ids();
    await assert.rejects(store.createConversation({ userId: 'x', workspaceId: me.workspaceId, title: 't' }));
    await assert.rejects(store.createConversation({ userId: me.userId, workspaceId: 'x', title: 't' }));
    await assert.rejects(store.createConversation({ ...me, title: 'x'.repeat(121) }));
    await store.createConversation({ ...me, title: 'x'.repeat(120) });
    for (const day of ['2026-1-1', '2026-13-45', '2026-02-30', 'today', '2026-10-06T00:00'])
      await assert.rejects(store.recordUsage({ day, ...me }), day);
    await assert.rejects(store.recordUsage({ day: '2026-10-06', userId: 'x', workspaceId: me.workspaceId }));
  });

  test('recentMessages: bounded by count and chars, always keeps the latest', async () => {
    const store = makeStore();
    const me = ids();
    const { id } = await create(store, me);
    assert.deepEqual(await store.recentMessages(id, me.userId, { maxMessages: 5, maxChars: 100 }), []);
    for (const c of ['aaaa', 'bbbb', 'cccc', 'dddd']) {
      await store.appendMessages(id, me.userId, [{ role: 'user', content: c }]);
      await sleep(3);
    }
    const text = async (o) => (await store.recentMessages(id, me.userId, o)).map((m) => m.content);
    assert.deepEqual(await text({ maxMessages: 2, maxChars: 1000 }), ['cccc', 'dddd']);
    assert.deepEqual(await text({ maxMessages: 10, maxChars: 8 }), ['cccc', 'dddd']);
    assert.deepEqual(await text({ maxMessages: 10, maxChars: 7 }), ['dddd']);
    assert.deepEqual(await text({ maxMessages: 10, maxChars: 1 }), ['dddd']);
    assert.deepEqual(await text({ maxMessages: 0, maxChars: 1000 }), ['dddd']);
  });

  test('deleteConversation: owner only, removes its messages', async () => {
    const store = makeStore();
    const me = ids();
    const { id } = await create(store, me);
    await store.appendMessages(id, me.userId, [{ role: 'user', content: 'bye' }]);
    assert.equal(await store.deleteConversation(id, randomUUID()), false);
    assert.equal(await store.deleteConversation('not-a-uuid', me.userId), false);
    assert.equal(await store.getConversation(id, me.userId) !== null, true);
    assert.equal(await store.deleteConversation(id, me.userId), true);
    assert.equal(await store.deleteConversation(id, me.userId), false);
    assert.equal(await store.getConversation(id, me.userId), null);
    assert.deepEqual(await store.recentMessages(id, me.userId, { maxMessages: 5, maxChars: 100 }), []);
  });

  test('recordUsage: per user, per workspace total, per day', async () => {
    const store = makeStore();
    const w = randomUUID();
    const u1 = randomUUID();
    const u2 = randomUUID();
    const day = '2026-10-06';
    assert.deepEqual(await store.recordUsage({ day, workspaceId: w, userId: u1 }), { userCalls: 1, workspaceCalls: 1 });
    assert.deepEqual(await store.recordUsage({ day, workspaceId: w, userId: u1 }), { userCalls: 2, workspaceCalls: 2 });
    assert.deepEqual(await store.recordUsage({ day, workspaceId: w, userId: u2 }), { userCalls: 1, workspaceCalls: 3 });
    assert.deepEqual(await store.recordUsage({ day: '2026-10-07', workspaceId: w, userId: u1 }), { userCalls: 1, workspaceCalls: 1 });
    assert.deepEqual(await store.recordUsage({ day, workspaceId: randomUUID(), userId: u1 }), { userCalls: 1, workspaceCalls: 1 });
  });

  test('recordUsage: concurrent calls are all counted', async () => {
    const store = makeStore();
    const who = ids();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.recordUsage({ day: '2026-10-06', ...who })),
    );
    assert.equal(Math.max(...results.map((r) => r.userCalls)), 20);
    assert.equal(new Set(results.map((r) => r.userCalls)).size, 20);
    assert.equal((await store.recordUsage({ day: '2026-10-06', ...who })).workspaceCalls, 21);
  });

  test('purge: conversations by updated_at, usage by day', async () => {
    const store = makeStore();
    const me = ids();
    const { id } = await create(store, me);
    await store.appendMessages(id, me.userId, [{ role: 'user', content: 'old' }]);
    await store.recordUsage({ day: '2020-01-01', workspaceId: me.workspaceId, userId: me.userId });
    const keep = { conversationRetentionDays: 30, usageRetentionDays: 90 };

    const now = new Date();
    const first = await store.purge(new Date(now.getTime() - 3600_000), keep);
    assert.equal(first.conversations, 0);
    assert.ok(first.usageRows >= 1);
    assert.equal((await store.purge(now, keep)).conversations, 0);
    assert.notEqual(await store.getConversation(id, me.userId), null);

    const later = await store.purge(new Date(now.getTime() + 31 * 86_400_000), keep);
    assert.ok(later.conversations >= 1);
    assert.equal(await store.getConversation(id, me.userId), null);
    assert.equal((await store.recordUsage({ day: '2020-01-01', ...me })).userCalls, 1);
  });
}

module.exports = { storeCases };
