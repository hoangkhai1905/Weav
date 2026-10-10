import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { WorkflowModule } from './workflow.module';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';

describe('workflow gateway routes', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [WorkflowModule],
    })
      .useMocker((token) =>
        token === ConfigService
          ? {
              get: () => ({
                upstreams: { workflow: 'http://workflow.internal:8080' },
              }),
            }
          : undefined,
      )
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());

  it('forwards list pagination to the Workflow Service path', async () => {
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [], page: 1, size: 20, totalElements: 0 }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );

    const response = await app.inject({
      url: `/api/v1/workspaces/${workspaceId}/workflows?page=1&size=20`,
      headers: {
        authorization: 'Bearer opaque-token',
        'x-user-id': 'untrusted',
        cookie: 'private',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith(
      `http://workflow.internal:8080/workspaces/${workspaceId}/workflows?page=1&size=20`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer opaque-token',
          'x-request-id': expect.any(String) as unknown,
          'x-correlation-id': expect.any(String) as unknown,
        }) as unknown,
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });

  it('routes node-capabilities to its own upstream path, not :workflowId', async () => {
    const capabilities = {
      nodes: { 'ocr.extract': { available: true, sources: ['url'] } },
    };
    const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(capabilities), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await app.inject({
      url: `/api/v1/workspaces/${workspaceId}/workflows/node-capabilities`,
      headers: { authorization: 'Bearer opaque-token', cookie: 'private' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(capabilities);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      `http://workflow.internal:8080/workspaces/${workspaceId}/workflows/node-capabilities`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer opaque-token',
        }) as unknown,
      }),
    );

    const missingToken = await app.inject(
      `/api/v1/workspaces/${workspaceId}/workflows/node-capabilities`,
    );
    expect(missingToken.statusCode).toBe(401);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('forwards workflow deletion and relays 204 without a body', async () => {
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`,
      headers: { authorization: 'Bearer opaque-token' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(request).toHaveBeenCalledWith(
      `http://workflow.internal:8080/workspaces/${workspaceId}/workflows/${workflowId}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('forwards draft saves and preserves the upstream response', async () => {
    const body = {
      name: 'Daily report',
      description: 'Send report',
      definition: { nodes: [], edges: [] },
      editorState: { positions: {} },
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ workflowId, ...body, status: 'DRAFT' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/draft`,
      headers: { authorization: 'Bearer opaque-token' },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      workflowId,
      status: 'DRAFT',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://workflow.internal:8080/workspaces/${workspaceId}/workflows/${workflowId}/draft`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
        headers: expect.objectContaining({
          authorization: 'Bearer opaque-token',
          'content-type': 'application/json',
        }) as unknown,
      }),
    );
  });

  it('forwards expectedRevision and passes a draft revision conflict through', async () => {
    const body = {
      name: 'Daily report',
      definition: { nodes: [], edges: [] },
      expectedRevision: 3,
    };
    const conflict = {
      error: {
        code: 'DRAFT_REVISION_CONFLICT',
        message: 'Workflow draft was changed by another save',
        details: [{ field: 'revision', message: '4' }],
      },
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(conflict), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/draft`,
      headers: { authorization: 'Bearer opaque-token' },
      payload: body,
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual(conflict);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify(body) }),
    );
  });

  it('rejects malformed IDs and missing bearer auth before upstream access', async () => {
    const request = jest.spyOn(globalThis, 'fetch');

    const invalidId = await app.inject({
      url: '/api/v1/workspaces/not-a-uuid/workflows',
      headers: { authorization: 'Bearer opaque-token' },
    });
    const missingToken = await app.inject(
      `/api/v1/workspaces/${workspaceId}/workflows`,
    );

    expect(invalidId.statusCode).toBe(400);
    expect(missingToken.statusCode).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });

  describe('telegram webhook ingress', () => {
    const key = 'T'.repeat(32);
    const secret = 'telegram_secret-token_0123456789';

    it('forwards only the Telegram secret header, never Authorization', async () => {
      const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/telegram/${key}`,
        headers: {
          authorization: 'Bearer client-token-must-not-leak',
          cookie: 'private',
          'x-webhook-secret': 'not-for-telegram-route',
          'x-telegram-bot-api-secret-token': secret,
        },
        payload: { update_id: 1, message: { text: 'hi' } },
      });

      expect(response.statusCode).toBe(200);
      expect(request).toHaveBeenCalledWith(
        `http://workflow.internal:8080/webhooks/telegram/${key}`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ update_id: 1, message: { text: 'hi' } }),
        }),
      );
      const headers = (
        request.mock.calls[0][1] as { headers: Record<string, string> }
      ).headers;
      expect(headers['x-telegram-bot-api-secret-token']).toBe(secret);
      expect(headers.authorization).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
      expect(headers['x-webhook-secret']).toBeUndefined();
    });

    it('rejects a malformed key or secret token before upstream access', async () => {
      const request = jest.spyOn(globalThis, 'fetch');

      const badKey = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/telegram/short',
        payload: {},
      });
      for (const token of ['bad token', 'a'.repeat(257), 'semi;colon']) {
        const badSecret = await app.inject({
          method: 'POST',
          url: `/api/v1/webhooks/telegram/${key}`,
          headers: { 'x-telegram-bot-api-secret-token': token },
          payload: {},
        });
        expect(badSecret.statusCode).toBe(400);
      }
      const form = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/telegram/${key}`,
        headers: { 'content-type': 'text/plain' },
        payload: 'x',
      });

      expect(badKey.statusCode).toBe(400);
      expect(form.statusCode).toBe(415);
      expect(request).not.toHaveBeenCalled();
    });

    it('passes the generic upstream not-found through unchanged', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'WEBHOOK_NOT_FOUND' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/telegram/${key}`,
        payload: { update_id: 1 },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  it('sanitizes upstream failures', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private-url'));

    const response = await app.inject({
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: { authorization: 'Bearer opaque-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private-url');
  });
  describe('stop a run (W6-C3)', () => {
    const executionId = '00000000-0000-4000-8000-0000000000e1';
    const auth = { authorization: 'Bearer opaque-token' };

    it('forwards the cancel request and relays 202, 404 and 409', async () => {
      const request = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'CANCEL_REQUESTED' }), {
            status: 202,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: 'EXECUTION_ALREADY_FINISHED' } }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
        );
      const url = `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions/${executionId}/cancel`;

      const accepted = await app.inject({ method: 'POST', url, headers: auth });
      const finished = await app.inject({ method: 'POST', url, headers: auth });

      expect([accepted.statusCode, finished.statusCode]).toEqual([202, 409]);
      expect(accepted.json()).toEqual({ status: 'CANCEL_REQUESTED' });
      expect(request).toHaveBeenCalledWith(
        `http://workflow.internal:8080/workspaces/${workspaceId}/workflows/${workflowId}/executions/${executionId}/cancel`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('rejects a malformed execution id and a missing token before upstream access', async () => {
      const request = jest.spyOn(globalThis, 'fetch');
      const base = `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions`;

      const badId = await app.inject({
        method: 'POST',
        url: `${base}/not-a-uuid/cancel`,
        headers: auth,
      });
      const noToken = await app.inject({
        method: 'POST',
        url: `${base}/${executionId}/cancel`,
      });

      expect(badId.statusCode).toBe(400);
      expect(noToken.statusCode).toBe(401);
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('monitoring routes (W6-A)', () => {
    const ruleId = '00000000-0000-4000-8000-000000000009';
    const json = { headers: { 'content-type': 'application/json' } };
    const auth = { authorization: 'Bearer opaque-token' };

    it('forwards run-history filters to the workspace executions path', async () => {
      const request = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(
            JSON.stringify({ items: [], page: 0, size: 20, totalElements: 0 }),
            json,
          ),
        );

      const response = await app.inject({
        url: `/api/v1/workspaces/${workspaceId}/executions?status=FAILED&workflowId=${workflowId}&from=2026-10-01T00:00:00Z&page=1&size=50`,
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      const target = new URL(request.mock.calls[0][0] as string);
      expect(target.pathname).toBe(`/workspaces/${workspaceId}/executions`);
      expect(Object.fromEntries(target.searchParams)).toEqual({
        status: 'FAILED',
        workflowId,
        from: '2026-10-01T00:00:00Z',
        page: '1',
        size: '50',
      });
    });

    it('rejects bad history and summary queries before upstream access', async () => {
      const request = jest.spyOn(globalThis, 'fetch');
      for (const query of [
        'executions?status=NOPE',
        'executions?size=101',
        'executions?from=yesterday',
        'executions?workflowId=nope',
        'executions?extra=1',
        'monitoring/summary?days=31',
        'monitoring/summary?days=0',
      ]) {
        const response = await app.inject({
          url: `/api/v1/workspaces/${workspaceId}/${query}`,
          headers: auth,
        });
        expect(response.statusCode).toBe(400);
      }
      expect(request).not.toHaveBeenCalled();
    });

    it('requires a bearer token', async () => {
      const request = jest.spyOn(globalThis, 'fetch');
      const response = await app.inject({
        url: `/api/v1/workspaces/${workspaceId}/monitoring/summary`,
      });
      expect(response.statusCode).toBe(401);
      expect(request).not.toHaveBeenCalled();
    });

    it('forwards the summary days', async () => {
      const request = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ days: 14 }), json));

      const response = await app.inject({
        url: `/api/v1/workspaces/${workspaceId}/monitoring/summary?days=14`,
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      expect(request.mock.calls[0][0]).toBe(
        `http://workflow.internal:8080/workspaces/${workspaceId}/monitoring/summary?days=14`,
      );
    });

    it('forwards alert-rule CRUD and validates the body', async () => {
      const request = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: ruleId }), {
            ...json,
            status: 201,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: ruleId }), json),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      const body = {
        name: 'Sync breaks',
        type: 'CONSECUTIVE_FAILURES',
        workflowId,
        threshold: 3,
        windowMinutes: 30,
      };

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/alert-rules`,
        headers: auth,
        payload: body,
      });
      const updated = await app.inject({
        method: 'PUT',
        url: `/api/v1/workspaces/${workspaceId}/alert-rules/${ruleId}`,
        headers: auth,
        payload: { ...body, enabled: false },
      });
      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/workspaces/${workspaceId}/alert-rules/${ruleId}`,
        headers: auth,
      });

      expect([
        created.statusCode,
        updated.statusCode,
        removed.statusCode,
      ]).toEqual([201, 200, 204]);
      expect(request.mock.calls.map((call) => call[0])).toEqual([
        `http://workflow.internal:8080/workspaces/${workspaceId}/alert-rules`,
        `http://workflow.internal:8080/workspaces/${workspaceId}/alert-rules/${ruleId}`,
        `http://workflow.internal:8080/workspaces/${workspaceId}/alert-rules/${ruleId}`,
      ]);
      const forwarded = JSON.parse(
        (request.mock.calls[0][1] as { body: string }).body,
      ) as unknown;
      expect(forwarded).toEqual(body);

      for (const payload of [
        { ...body, type: 'OTHER' },
        { ...body, threshold: 0 },
        { ...body, name: '' },
        { ...body, unknown: true },
      ]) {
        const rejected = await app.inject({
          method: 'POST',
          url: `/api/v1/workspaces/${workspaceId}/alert-rules`,
          headers: auth,
          payload,
        });
        expect(rejected.statusCode).toBe(400);
      }
      expect(request).toHaveBeenCalledTimes(3);
    });
  });

  describe('template routes (W6-C1)', () => {
    const templateId = '00000000-0000-4000-8000-00000000000a';
    const json = { headers: { 'content-type': 'application/json' } };
    const auth = { authorization: 'Bearer opaque-token' };
    const base = 'http://workflow.internal:8080';
    const workflowBase = `/workspaces/${workspaceId}/workflows/${workflowId}`;

    it('forwards share preview and share to the workflow template path', async () => {
      const request = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({}), json))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: templateId }), {
            ...json,
            status: 201,
          }),
        );
      const body = {
        name: 'Invoice mail',
        description: 'd',
        authorName: 'Khai',
        visibility: 'UNLISTED',
      };

      const preview = await app.inject({
        method: 'POST',
        url: `/api/v1/${workflowBase.slice(1)}/template/preview`,
        headers: auth,
      });
      const shared = await app.inject({
        method: 'PUT',
        url: `/api/v1/${workflowBase.slice(1)}/template`,
        headers: auth,
        payload: body,
      });

      expect([preview.statusCode, shared.statusCode]).toEqual([200, 201]);
      expect(request.mock.calls.map((call) => call[0])).toEqual([
        `${base}${workflowBase}/template/preview`,
        `${base}${workflowBase}/template`,
      ]);
      expect(
        request.mock.calls.map((call) => (call[1] as RequestInit).method),
      ).toEqual(['POST', 'PUT']);
      expect(
        JSON.parse((request.mock.calls[1][1] as { body: string }).body),
      ).toEqual(body);
    });

    it('forwards browse, read, patch, delete and use', async () => {
      const request = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: [] }), json),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({}), json))
        .mockResolvedValueOnce(new Response(JSON.stringify({}), json))
        .mockResolvedValueOnce(new Response(JSON.stringify({}), json))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ workflowId }), {
            ...json,
            status: 201,
          }),
        );

      const responses = [
        await app.inject({
          url: `/api/v1/templates?scope=workspace&workspaceId=${workspaceId}&q=hoa%20don&page=1&size=10`,
          headers: auth,
        }),
        await app.inject({
          url: `/api/v1/templates/${templateId}`,
          headers: auth,
        }),
        await app.inject({
          url: '/api/v1/templates/by-code/wv7k-3m9q',
          headers: auth,
        }),
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/templates/${templateId}`,
          headers: auth,
          payload: { visibility: 'PUBLIC' },
        }),
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/templates/${templateId}`,
          headers: auth,
        }),
        await app.inject({
          method: 'POST',
          url: `/api/v1/templates/${templateId}/use`,
          headers: auth,
          payload: { workspaceId, name: 'My copy' },
        }),
      ];

      expect(responses.map((response) => response.statusCode)).toEqual([
        200, 200, 200, 200, 204, 201,
      ]);
      expect(request.mock.calls.map((call) => call[0])).toEqual([
        `${base}/templates?scope=workspace&workspaceId=${workspaceId}&q=hoa+don&page=1&size=10`,
        `${base}/templates/${templateId}`,
        `${base}/templates/by-code/wv7k-3m9q`,
        `${base}/templates/${templateId}`,
        `${base}/templates/${templateId}`,
        `${base}/templates/${templateId}/use`,
      ]);
      expect(
        request.mock.calls.map((call) => (call[1] as RequestInit).method),
      ).toEqual(['GET', 'GET', 'GET', 'PATCH', 'DELETE', 'POST']);
      expect(
        JSON.parse((request.mock.calls[3][1] as { body: string }).body),
      ).toEqual({ visibility: 'PUBLIC' });
    });

    it('accepts null for optional string fields and forwards them', async () => {
      const request = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({}), json)),
        );

      const shared = await app.inject({
        method: 'PUT',
        url: `/api/v1/${workflowBase.slice(1)}/template`,
        headers: auth,
        payload: {
          name: 'x',
          description: null,
          authorName: null,
          visibility: 'PRIVATE',
        },
      });
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/templates/${templateId}`,
        headers: auth,
        payload: { name: null, description: null, visibility: null },
      });
      const used = await app.inject({
        method: 'POST',
        url: `/api/v1/templates/${templateId}/use`,
        headers: auth,
        payload: { workspaceId, name: null },
      });

      expect([shared.statusCode, patched.statusCode, used.statusCode]).toEqual([
        200, 200, 200,
      ]);
      const bodies = request.mock.calls.map(
        (call) => JSON.parse((call[1] as { body: string }).body) as unknown,
      );
      expect(bodies[0]).toEqual({
        name: 'x',
        description: null,
        authorName: null,
        visibility: 'PRIVATE',
      });
      expect(bodies[1]).toEqual({
        name: null,
        description: null,
        visibility: null,
      });
      expect(bodies[2]).toEqual({ workspaceId, name: null });
    });

    it('rejects bad input before upstream access', async () => {
      const request = jest.spyOn(globalThis, 'fetch');
      const bad = [
        {
          method: 'PUT',
          url: `/api/v1/${workflowBase.slice(1)}/template`,
          payload: { name: 'x' },
        },
        {
          method: 'PUT',
          url: `/api/v1/${workflowBase.slice(1)}/template`,
          payload: { name: '', visibility: 'PUBLIC' },
        },
        {
          method: 'PUT',
          url: `/api/v1/${workflowBase.slice(1)}/template`,
          payload: { name: 'x', visibility: 'SECRET' },
        },
        {
          method: 'PUT',
          url: `/api/v1/${workflowBase.slice(1)}/template`,
          payload: { name: 'x', visibility: 'PUBLIC', extra: 1 },
        },
        {
          method: 'PATCH',
          url: `/api/v1/templates/${templateId}`,
          payload: { owner: 'x' },
        },
        {
          method: 'POST',
          url: `/api/v1/templates/${templateId}/use`,
          payload: {},
        },
        {
          method: 'POST',
          url: '/api/v1/templates/not-a-uuid/use',
          payload: { workspaceId },
        },
        { method: 'GET', url: '/api/v1/templates?scope=nope' },
        { method: 'GET', url: '/api/v1/templates?size=500' },
        { method: 'GET', url: '/api/v1/templates/by-code/%2e%2e%2fsecret' },
      ] as const;

      for (const item of bad) {
        const response = await app.inject({
          method: item.method,
          url: item.url,
          headers: auth,
          payload: 'payload' in item ? item.payload : undefined,
        });
        expect([item.url, response.statusCode]).toEqual([item.url, 400]);
      }
      expect(request).not.toHaveBeenCalled();
    });

    it('requires a bearer token', async () => {
      const request = jest.spyOn(globalThis, 'fetch');

      const response = await app.inject({ url: '/api/v1/templates' });

      expect(response.statusCode).toBe(401);
      expect(request).not.toHaveBeenCalled();
    });
  });
});
