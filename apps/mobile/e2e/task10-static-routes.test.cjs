const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveTask10StaticTarget } = require('./task10-static-routes.cjs');

function makeExportFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task10-static-routes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.html'), '<main>root route</main>');
  fs.writeFileSync(path.join(root, 'notifications.html'), '<main>notifications route</main>');
  return root;
}

test('Task10 static server selects Expo route-specific HTML for clean paths', (t) => {
  const root = makeExportFixture(t);

  assert.equal(resolveTask10StaticTarget(root, '/notifications'), path.join(root, 'notifications.html'));
  assert.equal(resolveTask10StaticTarget(root, '/notifications/'), path.join(root, 'notifications.html'));
});

test('Task10 static server falls back only for unknown safe paths and rejects traversal', (t) => {
  const root = makeExportFixture(t);

  assert.equal(resolveTask10StaticTarget(root, '/missing'), path.join(root, 'index.html'));
  assert.equal(resolveTask10StaticTarget(root, '/../outside'), null);
});
