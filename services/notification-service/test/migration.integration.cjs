const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');

test('additive inbox migration preserves old deliveries and is repeatable without drift', { timeout: 90000 }, async () => {
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
  let databasePool;
  try {
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    databasePool = new Pool({ host: '127.0.0.1', port: 15439, user: 'notification_test', database });
    await databasePool.query(readFileSync(join(__dirname, '../prisma/migrations/202609090001_notification_deliveries/migration.sql'), 'utf8'));
    const fixture = {
      id: '00000000-0000-4000-8000-000000000101',
      userId: '00000000-0000-4000-8000-000000000102',
      executionId: '00000000-0000-4000-8000-000000000103',
      sourceEventId: '00000000-0000-4000-8000-000000000104',
    };
    await databasePool.query(
      `INSERT INTO notification.notification_deliveries
        (id,user_id,execution_id,source_event_id,provider,destination,event_type,payload,status,retry_count,last_error,read_at,scheduled_at,sent_at,created_at,updated_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'TELEGRAM','fixture-destination','workflow.completed',
        '{"workflowName":"legacy fixture","private":"preserve exactly"}'::jsonb,'SENDING',3,
        '{"code":"PRIVATE","message":"preserve exactly"}'::jsonb,
        '2025-01-01T00:00:00.001Z','2025-02-01T00:00:00.002Z',NULL,
        '2024-12-01T00:00:00.003Z','2025-03-01T00:00:00.004Z')`,
      [fixture.id, fixture.userId, fixture.executionId, fixture.sourceEventId],
    );
    const before = await databasePool.query(
      'SELECT to_jsonb(d) AS legacy FROM notification.notification_deliveries d WHERE id=$1::uuid',
      [fixture.id],
    );
    assert.equal(before.rowCount, 1);
    assert.equal(
      run(['migrate', 'resolve', '--applied', '202609090001_notification_deliveries']).status,
      0,
      'Could not mark the existing test fixture schema as the old migration baseline',
    );
    assert.equal(run(['migrate', 'deploy']).status, 0, 'Additive migration deployment failed');
    assert.equal(run(['migrate', 'deploy']).status, 0, 'Second migration deployment failed');
    const after = await databasePool.query(
      `SELECT to_jsonb(d) - 'inbox_id' AS legacy, inbox_id
       FROM notification.notification_deliveries d WHERE id=$1::uuid`,
      [fixture.id],
    );
    assert.equal(after.rowCount, 1);
    assert.deepEqual(after.rows[0].legacy, before.rows[0].legacy);
    assert.equal(after.rows[0].inbox_id, null);
    const diff = run(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
    // The diff contains schema names only; never print datasource configuration or command output.
    assert.equal(diff.status, 0, 'Migration drift detected; compare local test schema with prisma/schema.prisma');
  } finally {
    if (databasePool) await databasePool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
