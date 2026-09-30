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
    const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    expect(JSON.parse(response.body)).toMatchObject({ workflowId, status: 'DRAFT' });
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

  it('sanitizes upstream failures', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private-url'));

    const response = await app.inject({
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: { authorization: 'Bearer opaque-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private-url');
  });
});
