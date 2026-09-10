const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { Pool } = require('pg');

test('Prisma deploy is repeatable and migration matches the runtime schema', { timeout: 60000 }, async () => {
  const database = `notification_migration_${randomUUID().replaceAll('-', '')}`;
  assert.match(database, /^notification_migration_[a-f0-9]{32}$/);
  const admin = new Pool({ host: '127.0.0.1', port: 15439, user: 'notification_test', database: 'notification_test' });
  const url = new URL('postgresql://127.0.0.1:15439');
  url.username = 'notification_test'; url.pathname = database;
  url.searchParams.set('schema', 'notification'); url.searchParams.set('sslmode', 'disable');
  const run = args => spawnSync(process.execPath, [join(__dirname, '../node_modules/prisma/build/index.js'), ...args], {
    cwd: join(__dirname, '..'), timeout: 20000, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, NOTIFICATION_MIGRATION_URL: url.toString() },
  });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    assert.equal(run(['migrate', 'deploy']).status, 0, 'Initial migration deployment failed');
    assert.equal(run(['migrate', 'deploy']).status, 0, 'Second migration deployment failed');
    const diff = run(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
    // The diff contains schema names only; never print datasource configuration or command output.
    assert.equal(diff.status, 0, 'Migration drift detected; compare local test schema with prisma/schema.prisma');
  } finally {
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
