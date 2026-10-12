import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { IdentityModule } from './identity.module';

describe('identity gateway response cap', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [IdentityModule],
    })
      .useMocker((token) =>
        token === ConfigService
          ? {
              get: () => ({
                upstreams: { identity: 'http://identity.internal:8080' },
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

  const login = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@example.test', password: 'not-a-real-password' },
    });

  it('relays a normal upstream JSON response unchanged', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await login();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('maps an upstream response over the 1 MiB cap to a clean 502', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ blob: 'x'.repeat(1_100_000) }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await login();

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'BAD_GATEWAY', message: 'Invalid Identity response' },
      status: 502,
    });
    expect(response.body).not.toContain('xxxx');
  });
});
