const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeTask10Error,
  sanitizeTask10Path,
  formatTask10HttpSummary,
  formatTask10HttpFailure,
  formatTask10ConsoleFailure,
} = require('./task10-error-sanitizer.cjs');

function requireDiagnosticHelper(helper) {
  assert.equal(typeof helper, 'function');
  return helper;
}

test('Task10 error diagnostics preserve exception identity and redact sensitive payloads', () => {
  const diagnostic = sanitizeTask10Error(new TypeError(
    'Request failed for owner@example.test at https://127.0.0.1:43210/api?access_token=header.payload.signature',
  ));

  assert.match(diagnostic, /^TypeError: Request failed for \[email\] at \[url\]$/);
  assert.doesNotMatch(diagnostic, /owner@example\.test|127\.0\.0\.1|header\.payload\.signature|access_token/i);
});

test('Task10 error diagnostics redact bare token and API-key fields', () => {
  const diagnostic = sanitizeTask10Error(new Error('token=raw-token-value api_key=raw-api-key-value'));

  assert.match(diagnostic, /\[sensitive field redacted\]/);
  assert.doesNotMatch(diagnostic, /raw-token-value|raw-api-key-value/);
});

test('Task10 error diagnostics bound and normalize arbitrary runtime messages', () => {
  const diagnostic = sanitizeTask10Error({ name: 'Error', message: `  ${'x'.repeat(500)}  ` });

  assert.equal(diagnostic.length, 243);
  assert.equal(diagnostic.slice(-3), '...');
});

test('Task10 browser paths retain route identity but strip origin, query, fragment, and IDs', () => {
  const path = requireDiagnosticHelper(sanitizeTask10Path)(
    'https://user:pass@127.0.0.1:43210/api/v2/notifications/550e8400-e29b-41d4-a716-446655440000?access_token=secret#private',
  );

  assert.equal(path, '/api/v2/notifications/:id');
  assert.doesNotMatch(path, /https?:|127\.0\.0\.1|43210|access_token|secret|550e8400|private/);
});

test('Task10 browser paths redact email and opaque credential-like path segments', () => {
  const sanitizePath = requireDiagnosticHelper(sanitizeTask10Path);
  const emailPath = sanitizePath('http://127.0.0.1/api/users/member%40example.test?x=1');
  const secretPath = sanitizePath(`http://127.0.0.1/api/reset/${'a'.repeat(48)}`);
  const numericIdPath = sanitizePath('http://127.0.0.1/api/users/123456');
  const bearerPath = sanitizePath('http://127.0.0.1/api/Bearer%20short-secret');

  assert.equal(emailPath, '/api/users/:redacted');
  assert.equal(secretPath, '/api/reset/:redacted');
  assert.equal(numericIdPath, '/api/users/:id');
  assert.equal(bearerPath, '/api/:redacted');
});

test('Task10 HTTP failure evidence correlates browser label, phase, request path, and status', () => {
  const diagnostic = requireDiagnosticHelper(formatTask10HttpFailure)({
    label: 'expoweb',
    phase: 'notifications-initial-load',
    method: 'GET',
    url: 'http://127.0.0.1:43123/api/workflows?access_token=secret#ignored',
    status: 404,
  });

  assert.equal(diagnostic, 'expoweb phase=notifications-initial-load response GET /api/workflows status=404');
  assert.doesNotMatch(diagnostic, /127\.0\.0\.1|43123|access_token|secret|ignored/);
});

test('Task10 HTTP summary strips query and fragment from API evidence paths', () => {
  const diagnostic = requireDiagnosticHelper(formatTask10HttpSummary)({
    method: 'GET',
    url: '/api/v2/notifications/550e8400-e29b-41d4-a716-446655440000?limit=100&locale=vi&access_token=secret#private',
    status: 200,
  });

  assert.equal(diagnostic, 'GET /api/v2/notifications/:id 200');
  assert.doesNotMatch(diagnostic, /limit=|locale=|access_token|secret|private|550e8400/);
});

test('Task10 console evidence records only sanitized location pathname and bounded message', () => {
  const diagnostic = requireDiagnosticHelper(formatTask10ConsoleFailure)({
    label: 'expoweb',
    phase: 'notifications-initial-load',
    locationUrl: 'http://127.0.0.1:43123/assets/index.js?token=secret#private',
    message: 'Failed to load https://127.0.0.1:43123/api/users/member@example.test?token=secret (404)',
  });

  assert.match(diagnostic, /^expoweb phase=notifications-initial-load console location=\/assets\/index\.js message=ConsoleError:/);
  assert.doesNotMatch(diagnostic, /127\.0\.0\.1|43123|member@example\.test|token=secret|private/);
});
