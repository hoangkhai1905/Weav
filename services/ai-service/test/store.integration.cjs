/* Real PostgreSQL (test/compose.yml, port 55433) + compiled store (run `pnpm build` first). Throwaway database only. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { Pool } = require('pg');
const { storeCases } = require('./support/store-cases.cjs');
const {
  PrismaConversationStore,
} = require('../dist/infrastructure/persistence/prisma-conversation-store');

const PORT = 55433;
const database = `ai_store_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ host: '127.0.0.1', port: PORT, user: 'ai_test', database: 'ai_test' });
const url = new URL(`postgresql://127.0.0.1:${PORT}`);
url.username = 'ai_test';
url.pathname = database;
url.searchParams.set('schema', 'ai');
url.searchParams.set('sslmode', 'disable');
const prisma = (args) =>
  spawnSync(process.execPath, [join(__dirname, '../node_modules/prisma/build/index.js'), ...args], {
    cwd: join(__dirname, '..'), timeout: 60000, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, AI_MIGRATION_URL: url.toString() },
  });

let created = false;
let store;
before(async () => {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  assert.equal(prisma(['migrate', 'deploy']).status, 0, 'migration deployment failed');
  store = new PrismaConversationStore({
    host: '127.0.0.1', port: PORT, database, user: 'ai_test', ssl: false,
  });
});
after(async () => {
  if (store) await store.close();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
});

test('migration is repeatable and matches schema.prisma', () => {
  assert.equal(prisma(['migrate', 'deploy']).status, 0, 'second deployment failed');
  const diff = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
  assert.equal(diff.status, 0, 'migration drift detected');
});

test('database rejects bad role, oversized content and orphan messages', async () => {
  const pool = new Pool({ host: '127.0.0.1', port: PORT, user: 'ai_test', database });
  try {
    const { id } = await store.createConversation({ userId: randomUUID(), workspaceId: randomUUID(), title: 't' });
    const insert = (role, content, conv = id) =>
      pool.query('INSERT INTO ai.messages (id, conversation_id, role, content) VALUES ($1,$2,$3,$4)', [randomUUID(), conv, role, content]);
    await assert.rejects(insert('system', 'x'), /messages_role_check/);
    await assert.rejects(insert('user', 'x'.repeat(16001)), /messages_content_length_check/);
    await assert.rejects(insert('user', 'x', randomUUID()), /messages_conversation_id_fkey/);
    await insert('user', 'ok');
  } finally {
    await pool.end();
  }
});

storeCases({ test, assert, makeStore: () => store });
