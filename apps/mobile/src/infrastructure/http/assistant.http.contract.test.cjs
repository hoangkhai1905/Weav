const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  ASSISTANT_CHAT_TIMEOUT_MS,
  assistantChatUrl,
  buildAssistantChatBody,
  buildConversationListRequest,
  buildConversationMessagesRequest,
  buildDeleteConversationRequest,
} = require('./assistant.http.contract.ts');

const WS = '11111111-1111-4111-8111-111111111111';
const CV = '55555555-5555-4555-8555-555555555555';

test('chat body is strict and chat uses an 80 s timeout', () => {
  assert.equal(assistantChatUrl(), '/api/v1/assistant/chat');
  assert.equal(ASSISTANT_CHAT_TIMEOUT_MS, 80000);
  assert.deepEqual(buildAssistantChatBody(WS, { message: 'hi' }), { workspaceId: WS, message: 'hi' });
  assert.deepEqual(
    buildAssistantChatBody(WS, { message: 'hi', conversationId: CV, timezone: 'UTC' }),
    { workspaceId: WS, conversationId: CV, message: 'hi', timezone: 'UTC' },
  );
  assert.throws(() => buildAssistantChatBody(WS, { message: '' }), /message/i);
  assert.throws(() => buildAssistantChatBody(WS, { message: 'x'.repeat(4001) }), /message/i);
  assert.throws(() => buildAssistantChatBody(WS, { message: 'a', conversationId: 'x' }), /conversation/i);
});

test('conversation routes', () => {
  assert.deepEqual(
    buildConversationListRequest(WS, { limit: 20, before: '2026-09-01T00:00:00+07:00' }),
    {
      url: '/api/v1/assistant/conversations',
      params: { workspaceId: WS, limit: 20, before: '2026-09-01T00:00:00+07:00' },
    },
  );
  assert.throws(() => buildConversationListRequest(WS, { limit: 51 }), /limit/i);
  assert.deepEqual(buildConversationMessagesRequest(CV), {
    url: `/api/v1/assistant/conversations/${CV}/messages`,
  });
  assert.deepEqual(buildDeleteConversationRequest(CV), {
    method: 'DELETE',
    url: `/api/v1/assistant/conversations/${CV}`,
  });
  assert.throws(() => buildDeleteConversationRequest('x'), /conversation/i);
});
