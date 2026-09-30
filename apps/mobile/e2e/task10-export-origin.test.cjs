const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { assertExpoExportUsesGateway, assertGatewayOriginInBundles } = require('./task10-export-origin.cjs');

test('accepts the Gateway origin configured for this Expo export', () => {
  assert.doesNotThrow(() => assertGatewayOriginInBundles(
    ['window.__task10Client = "http://127.0.0.1:48173/api";'],
    'http://127.0.0.1:48173',
  ));
});

test('rejects a JavaScript bundle carrying a different run origin', () => {
  assert.throws(
    () => assertGatewayOriginInBundles(
      ['window.__task10Client = "http://127.0.0.1:48173/api";'],
      'http://127.0.0.1:48174',
    ),
    /does not embed this run’s configured Gateway origin/,
  );
});

test('rejects a previous-run origin even when the current origin is also present', () => {
  assert.throws(
    () => assertGatewayOriginInBundles(
      ['window.__task10Client = ["http://127.0.0.1:48173", "http://127.0.0.1:48174"];'],
      'http://127.0.0.1:48174',
      ['http://127.0.0.1:48173'],
    ),
    /contains an origin from a previous run/,
  );
});

test('rejects an export with no browser JavaScript assets', () => {
  assert.throws(
    () => assertGatewayOriginInBundles([], 'http://127.0.0.1:48173'),
    /found no browser JavaScript assets/,
  );
});

test('checks the JavaScript file referenced by the exported browser index', (t) => {
  const exportDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'task10-export-origin-test-'));
  t.after(() => fs.rmSync(exportDirectory, { recursive: true, force: true }));
  const assetDirectory = path.join(exportDirectory, '_expo', 'static', 'js', 'web');
  fs.mkdirSync(assetDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(exportDirectory, 'index.html'),
    '<html><script src="/_expo/static/js/web/entry-test.js"></script></html>',
  );
  fs.writeFileSync(
    path.join(assetDirectory, 'entry-test.js'),
    'window.__task10Client = "http://127.0.0.1:48173/api";',
  );

  assert.doesNotThrow(() => assertExpoExportUsesGateway(exportDirectory, 'http://127.0.0.1:48173'));
});
