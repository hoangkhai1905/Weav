const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { normalizeApiError } = require('./http-client.ts');

function axiosFailure(status, data, headers = {}) {
  return new axios.AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    {},
    null,
    {
      status,
      statusText: 'Error',
      headers,
      config: {},
      data,
    },
  );
}

test('preserves a Gateway-generated nested error envelope and request id', () => {
  const error = normalizeApiError(
    axiosFailure(403, {
      error: {
        code: 'MEMBERSHIP_FORBIDDEN',
        message: 'Membership required',
        details: [{ field: 'workspaceId' }],
      },
      status: 403,
      requestId: 'gateway-request-1',
    }),
  );

  assert.deepEqual(error, {
    code: 'MEMBERSHIP_FORBIDDEN',
    message: 'Membership required',
    details: [{ field: 'workspaceId' }],
    status: 403,
    requestId: 'gateway-request-1',
  });
});

test('preserves a downstream Workspace top-level error response', () => {
  const error = normalizeApiError(
    axiosFailure(404, {
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace not found',
      requestId: 'workspace-request-1',
    }),
  );

  assert.deepEqual(error, {
    code: 'WORKSPACE_NOT_FOUND',
    message: 'Workspace not found',
    requestId: 'workspace-request-1',
    status: 404,
  });
});

test('uses the Gateway request-id header for downstream nested errors', () => {
  const error = normalizeApiError(
    axiosFailure(
      401,
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication failed',
          details: [],
        },
        status: 401,
        path: '/auth/me',
      },
      { 'x-request-id': 'gateway-request-2' },
    ),
  );

  assert.deepEqual(error, {
    code: 'UNAUTHORIZED',
    message: 'Authentication failed',
    details: [],
    status: 401,
    requestId: 'gateway-request-2',
  });
});
