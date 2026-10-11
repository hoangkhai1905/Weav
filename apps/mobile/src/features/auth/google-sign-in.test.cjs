const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
require('../../../test-support/register-typescript.cjs');
const {
  base64ToBase64Url,
  buildGoogleStartUrl,
  codeVerifierFrom,
  googleErrorKey,
  parseGoogleCallback,
} = require('./google-sign-in.ts');

const ID = 'a'.repeat(43);
const CODE = 'B_-9'.repeat(10) + 'xyz';

test('verifier is 43 url-safe chars and the challenge is 43 base64url chars (RFC 7636 S256)', () => {
  const verifier = codeVerifierFrom(randomBytes(43));
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const challenge = base64ToBase64Url(createHash('sha256').update(verifier).digest('base64'));
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  // RFC 7636 appendix B test vector.
  assert.equal(
    base64ToBase64Url(createHash('sha256').update('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').digest('base64')),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
  assert.throws(() => codeVerifierFrom(new Uint8Array(42)));
});

test('start url needs the identity public url and trims trailing slashes', () => {
  assert.equal(buildGoogleStartUrl(undefined, 'c'), null);
  assert.equal(buildGoogleStartUrl('  ', 'c'), null);
  assert.equal(
    buildGoogleStartUrl('https://id.example.test/', 'abc'),
    'https://id.example.test/auth/oauth/google/mobile/start?codeChallenge=abc&codeChallengeMethod=S256',
  );
});

test('callback: success, cancelled, provider failure and garbage', () => {
  assert.deepEqual(parseGoogleCallback(`weav://auth/callback?transaction_id=${ID}&handoff_code=${CODE}`), {
    kind: 'success',
    transactionId: ID,
    handoffCode: CODE,
  });
  assert.deepEqual(parseGoogleCallback(`weav://auth/callback?transaction_id=${ID}&oauth_error=cancelled`), { kind: 'cancelled' });
  assert.deepEqual(parseGoogleCallback(`weav://auth/callback?transaction_id=${ID}&oauth_error=provider_unavailable`), {
    kind: 'unavailable',
  });
  assert.deepEqual(parseGoogleCallback(`weav://auth/callback?transaction_id=${ID}&handoff_code=short`), { kind: 'unavailable' });
  assert.deepEqual(parseGoogleCallback('weav://auth/callback'), { kind: 'unavailable' });
});

test('exchange errors map by status first, then code', () => {
  assert.equal(googleErrorKey({ status: 409, code: 'ACCOUNT_LINK_REQUIRED' }), 'au.google.err.linkRequired');
  assert.equal(googleErrorKey({ status: 409, code: 'CONFLICT' }), 'au.google.err.retry');
  assert.equal(googleErrorKey({ status: 401, code: 'OAUTH_HANDOFF_INVALID' }), 'au.google.err.retry');
  assert.equal(googleErrorKey({ status: 401, code: 'UNAUTHORIZED' }), 'au.google.err.notAllowed');
  assert.equal(googleErrorKey({ status: 429, code: 'RATE_LIMITED' }), 'au.err.429');
  assert.equal(googleErrorKey({ status: 503 }), 'au.google.err.unavailable');
  assert.equal(googleErrorKey({ status: 400, code: 'BAD_REQUEST' }), 'au.google.err.unavailable');
  assert.equal(googleErrorKey(new Error('offline')), 'au.err.network');
});
