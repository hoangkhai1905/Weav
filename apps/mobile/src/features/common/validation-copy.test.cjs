const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { VALIDATION_KEYS } = require('./validation-copy.ts');
const { translations } = require('../../stores/i18n.store.ts');
const { validateChangePassword } = require('../auth/change-password.utils.ts');
const { validatePasswordRecovery } = require('../auth/password-recovery.utils.ts');
const { validateMemberEmail, validateWorkspaceName } = require('../workspace/workspace.mutations.ts');
const { validateDisplayName } = require('../profile/profile.utils.ts');

test('every sentence the validators can return has a translation in both languages', () => {
  const messages = new Set([
    ...Object.values(validateChangePassword({ currentPassword: '', newPassword: '', confirmPassword: 'x' })),
    ...Object.values(validateChangePassword({ currentPassword: 'a', newPassword: 'a', confirmPassword: 'b' })),
    ...Object.values(validatePasswordRecovery({ email: '', code: '1', newPassword: '', confirmPassword: 'x' })),
    ...Object.values(validatePasswordRecovery({ email: 'nope', code: '1', newPassword: 'a', confirmPassword: 'b' })),
    validateMemberEmail(''),
    validateMemberEmail('nope'),
    validateMemberEmail('x'.repeat(321) + '@example.com'),
    validateWorkspaceName('', true),
    validateWorkspaceName('x'.repeat(256), true),
    validateDisplayName('x'.repeat(121)),
  ]);
  assert.ok(messages.size >= 12);
  for (const message of messages) {
    const key = VALIDATION_KEYS[message];
    assert.ok(key, `no key for: ${message}`);
    assert.ok(translations.VI[key], `VI ${key}`);
    assert.ok(translations.EN[key], `EN ${key}`);
  }
});
