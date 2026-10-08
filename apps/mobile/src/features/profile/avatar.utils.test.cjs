const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { AVATAR_MAX_BYTES, checkAvatarImage } = require('./avatar.utils.ts');

test('accepts JPEG, PNG and WebP and names the upload after the real type', () => {
  assert.deepEqual(checkAvatarImage({ uri: 'file:///a/IMG_1.HEIC.jpg', mimeType: 'image/jpeg', fileSize: 1000 }), {
    ok: true,
    file: { uri: 'file:///a/IMG_1.HEIC.jpg', name: 'avatar.jpg', type: 'image/jpeg' },
  });
  assert.equal(checkAvatarImage({ uri: 'x', mimeType: 'image/png' }).file.name, 'avatar.png');
  assert.equal(checkAvatarImage({ uri: 'x', mimeType: 'image/webp' }).file.type, 'image/webp');
  assert.equal(checkAvatarImage({ uri: 'x', mimeType: 'image/jpg' }).file.type, 'image/jpeg');
});

test('falls back to the file extension when the picker gives no mime type', () => {
  assert.equal(checkAvatarImage({ uri: 'file:///a/photo.PNG?x=1' }).file.type, 'image/png');
  assert.equal(checkAvatarImage({ uri: 'content://media/9', fileName: 'me.jpeg' }).file.type, 'image/jpeg');
});

test('rejects types the server does not accept', () => {
  for (const mimeType of ['image/heic', 'image/gif', 'image/svg+xml', 'video/mp4']) {
    assert.deepEqual(checkAvatarImage({ uri: 'file:///a/b', mimeType }), { ok: false, problem: 'type' });
  }
  assert.deepEqual(checkAvatarImage({ uri: 'content://media/9' }), { ok: false, problem: 'type' });
});

test('rejects files above 2 MiB but allows exactly 2 MiB or an unknown size', () => {
  assert.deepEqual(checkAvatarImage({ uri: 'x', mimeType: 'image/png', fileSize: AVATAR_MAX_BYTES + 1 }), {
    ok: false,
    problem: 'size',
  });
  assert.equal(checkAvatarImage({ uri: 'x', mimeType: 'image/png', fileSize: AVATAR_MAX_BYTES }).ok, true);
  assert.equal(checkAvatarImage({ uri: 'x', mimeType: 'image/png', fileSize: null }).ok, true);
});
