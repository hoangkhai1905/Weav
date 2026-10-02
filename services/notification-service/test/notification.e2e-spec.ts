import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWK,
} from 'jose';
import { AppModule } from '../src/app.module';
import { AccessGuard } from '../src/presentation/http';
import { SETTINGS } from '../src/config/settings';
import { DeliveryRepository } from '../src/domain/notification';
import { InboxRepository } from '../src/domain/inbox';
import { DeliveryWorker } from '../src/application/delivery.worker';
import { RabbitConsumer } from '../src/infrastructure/rabbit.consumer';
import {
  mockRepository,
  testDelivery,
  testSettings,
} from '../src/testing/fixtures';

function sign(
  payload: Record<string, unknown>,
  secret: string,
  o: { algorithm: string; issuer: string; audience: string },
) {
  const part = (v: object) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${part({ alg: o.algorithm, typ: 'JWT' })}.${part({ ...payload, iss: o.issuer, aud: o.audience })}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

describe('notification HTTP (real Nest + Fastify)', () => {
  let app: NestFastifyApplication;
  const repo = mockRepository();
  const inboxRepository = {
    ingest: jest.fn(),
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    ready: jest.fn(),
    reconcileLegacy: jest.fn(),
  };
  const settings = testSettings();
  const userId = randomUUID();
  const rabbit = { isReady: true };
  function token(extra: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return sign(
      {
        sub: userId,
        sid: randomUUID(),
        jti: randomUUID(),
        token_use: 'access',
        user_status: 'ACTIVE',
        system_role: 'USER',
        iat: now,
        nbf: now,
        exp: now + 3600,
        ...extra,
      },
      settings.JWT_ACCESS_SECRET,
      {
        algorithm: 'HS256',
        issuer: settings.JWT_ISSUER,
        audience: settings.JWT_AUDIENCE,
      },
    );
  }
  const headers = () => ({ authorization: `Bearer ${token()}` });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SETTINGS)
      .useValue(settings)
      .overrideProvider(DeliveryRepository)
      .useValue(repo)
      .overrideProvider(InboxRepository)
      .useValue(inboxRepository)
      .overrideProvider(RabbitConsumer)
      .useValue(rabbit)
      .overrideProvider(DeliveryWorker)
      .useValue({})
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    repo.ready.mockResolvedValue(true);
    inboxRepository.ready.mockResolvedValue(true);
    rabbit.isReady = true;
  });
  it.each(['/api/v1/notifications', '/api/notifications'])(
    'serves %s and ignores forged user headers',
    async (url) => {
      const row = testDelivery();
      row.userId = userId;
      repo.list.mockResolvedValue([row]);
      const response = await app.inject({
        url,
        headers: { ...headers(), 'x-user-id': randomUUID() },
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json<{ items: { read: boolean }[] }>().items[0].read,
      ).toBe(false);
      expect(repo.list).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ limit: 20, unreadOnly: false }),
      );
      expect(response.body).not.toContain('destination');
    },
  );
  it.each([
    { token_use: 'refresh' },
    { user_status: 'DISABLED' },
    { exp: 1 },
    { sid: 'bad' },
    { iat: 9999999999 },
  ])('rejects invalid claims %j', async (claims) => {
    expect(
      (
        await app.inject({
          url: '/api/notifications',
          headers: { authorization: `Bearer ${token(claims)}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(repo.list).not.toHaveBeenCalled();
  });
  it('rejects unsigned requests, invalid signatures, and query injection', async () => {
    expect((await app.inject('/api/notifications')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/notifications',
          headers: { authorization: 'Bearer abc.def.ghi' },
        })
      ).statusCode,
    ).toBe(401);
    for (const query of [
      'limit=101',
      'unreadOnly=0',
      'cursor=garbage',
      'userId=someone',
      'status=UNKNOWN',
    ])
      expect(
        (
          await app.inject({
            url: `/api/notifications?${query}`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(400);
  });
  it('returns 404 for another user and marks owned rows', async () => {
    repo.markRead.mockResolvedValue(null);
    const id = randomUUID();
    const request = {
      method: 'PATCH' as const,
      url: `/api/notifications/${id}/read`,
      headers: headers(),
    };
    expect((await app.inject(request)).statusCode).toBe(404);
    expect(repo.markRead).toHaveBeenCalledWith(userId, id);
    const row = testDelivery();
    row.readAt = new Date();
    repo.markRead.mockResolvedValue(row);
    expect(
      (await app.inject(request)).json<{ item: { read: boolean } }>().item.read,
    ).toBe(true);
  });
  it('exposes count and read-all', async () => {
    repo.unreadCount.mockResolvedValue(3);
    repo.markAllRead.mockResolvedValue(3);
    expect(
      (
        await app.inject({
          url: '/api/v1/notifications/unread-count',
          headers: headers(),
        })
      ).json(),
    ).toEqual({ count: 3 });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/notifications/read-all',
          headers: headers(),
        })
      ).json(),
    ).toEqual({ updatedCount: 3 });
    expect(repo.markAllRead).toHaveBeenCalledWith(userId);
  });
  it('serves a strict localized v2 inbox view with a cursor from the last returned row', async () => {
    const workspaceId = randomUUID();
    const first = {
      id: randomUUID(),
      dedupKey: `event:${randomUUID()}:user:${userId}`,
      sourceEventId: randomUUID(),
      userId,
      actorUserId: randomUUID(),
      eventType: 'workspace.renamed',
      category: 'WORKSPACE' as const,
      severity: 'INFO' as const,
      workspaceId,
      executionId: null,
      content: {
        vi: {
          category: 'WORKSPACE' as const,
          severity: 'INFO' as const,
          title: 'Đã đổi tên',
          message: 'Tên đã được đổi.',
          target: { kind: 'WORKSPACE' as const, workspaceId },
        },
        en: {
          category: 'WORKSPACE' as const,
          severity: 'INFO' as const,
          title: 'Workspace renamed',
          message: 'The workspace name changed.',
          target: { kind: 'WORKSPACE' as const, workspaceId },
          destination: 'private-destination',
        },
      },
      occurredAt: new Date('2026-09-27T04:00:00.000Z'),
      createdAt: new Date('2026-09-27T04:01:00.000Z'),
      readAt: null,
    };
    const second = { ...first, id: randomUUID() };
    inboxRepository.list.mockResolvedValue([first, second]);

    const response = await app.inject({
      url: '/api/v2/notifications?limit=1&unreadOnly=true&category=WORKSPACE&locale=en',
      headers: { ...headers(), 'x-user-id': randomUUID() },
    });

    expect(response.statusCode).toBe(200);
    expect(inboxRepository.list).toHaveBeenCalledWith(userId, {
      limit: 1,
      unreadOnly: true,
      category: 'WORKSPACE',
    });
    const body = response.json<{
      items: Record<string, unknown>[];
      nextCursor: string | null;
    }>();
    expect(body.items[0]).toEqual({
      id: first.id,
      eventType: first.eventType,
      category: 'WORKSPACE',
      severity: 'INFO',
      title: 'Workspace renamed',
      message: 'The workspace name changed.',
      target: { kind: 'WORKSPACE', workspaceId },
      workspaceId,
      executionId: null,
      occurredAt: first.occurredAt.toISOString(),
      createdAt: first.createdAt.toISOString(),
      readAt: null,
    });
    expect(Object.keys(body.items[0]).sort()).toEqual(
      [
        'id',
        'eventType',
        'category',
        'severity',
        'title',
        'message',
        'target',
        'workspaceId',
        'executionId',
        'occurredAt',
        'createdAt',
        'readAt',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toContain('destination');
    expect(JSON.stringify(body)).not.toContain('sourceEventId');
    expect(
      JSON.parse(Buffer.from(body.nextCursor!, 'base64url').toString()),
    ).toEqual({
      id: first.id,
      createdAt: first.createdAt.toISOString(),
    });
  });
  it('rejects repeated, unknown, invalid and oversized v2 query values', async () => {
    for (const query of [
      'limit=1&limit=2',
      'limit=0',
      'limit=101',
      'limit=1.5',
      'unreadOnly=1',
      'category=UNKNOWN',
      'locale=fr',
      'userId=someone',
      `cursor=${'a'.repeat(513)}`,
    ]) {
      const response = await app.inject({
        url: `/api/v2/notifications?${query}`,
        headers: headers(),
      });
      expect(response.statusCode).toBe(400);
    }
    expect(inboxRepository.list).not.toHaveBeenCalled();
  });
  it('scopes v2 read, read-all and unread count to the JWT subject', async () => {
    const itemId = randomUUID();
    inboxRepository.unreadCount.mockResolvedValue(4);
    inboxRepository.markRead.mockResolvedValue(null);
    inboxRepository.markAllRead.mockResolvedValue(3);

    expect(
      (
        await app.inject({
          url: '/api/v2/notifications/unread-count',
          headers: headers(),
        })
      ).json(),
    ).toEqual({ count: 4 });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v2/notifications/${itemId}/read?locale=en`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
    expect(inboxRepository.markRead).toHaveBeenCalledWith(userId, itemId);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v2/notifications/read-all',
          headers: headers(),
        })
      ).json(),
    ).toEqual({ updatedCount: 3 });
    expect(inboxRepository.markAllRead).toHaveBeenCalledWith(userId);
    expect(
      (
        await app.inject({
          url: '/api/v2/notifications/unread-count?userId=forged',
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: '/api/v2/notifications/unread-count',
        })
      ).statusCode,
    ).toBe(401);
  });
  it('reports readiness separately and sanitizes failures', async () => {
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/ready')).statusCode).toBe(200);
    inboxRepository.ready.mockResolvedValue(false);
    expect((await app.inject('/ready')).statusCode).toBe(503);
    inboxRepository.ready.mockResolvedValue(true);
    rabbit.isReady = false;
    expect((await app.inject('/ready')).statusCode).toBe(503);
    repo.list.mockRejectedValue(new Error('postgres://private-password'));
    const response = await app.inject({
      url: '/api/notifications',
      headers: headers(),
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private-password');
  });
});

describe('AccessGuard RS256 via JWKS', () => {
  const kid = 'test-key';
  const settings = testSettings();
  const sub = randomUUID();
  let server: Server;
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  let guard: AccessGuard;
  const claims = (user_status = 'ACTIVE') => ({
    sid: randomUUID(),
    jti: randomUUID(),
    token_use: 'access',
    system_role: 'USER',
    user_status,
  });
  const rs256 = (payload: object, header: { alg: string; kid?: string }) =>
    new SignJWT({ ...payload })
      .setProtectedHeader(header)
      .setSubject(sub)
      .setIssuer(settings.JWT_ISSUER)
      .setAudience(settings.JWT_AUDIENCE)
      .setIssuedAt()
      .setNotBefore('0s')
      .setExpirationTime('5m')
      .sign(privateKey);
  const run = (g: AccessGuard, token: string) => {
    const request = { headers: { authorization: `Bearer ${token}` } } as {
      headers: { authorization: string };
      userId?: string;
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    return g.canActivate(context).then(() => request.userId);
  };
  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid, alg: 'RS256' };
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    guard = new AccessGuard({
      ...settings,
      JWT_JWKS_URI: `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`,
    });
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('accepts RS256 with a known kid and keeps the claim checks', async () => {
    await expect(
      run(guard, await rs256(claims(), { alg: 'RS256', kid })),
    ).resolves.toBe(sub);
    await expect(
      run(guard, await rs256(claims('DISABLED'), { alg: 'RS256', kid })),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('rejects an unknown kid', async () => {
    await expect(
      run(guard, await rs256(claims(), { alg: 'RS256', kid: 'other' })),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('rejects HS256 signed with the RSA public key as the HMAC secret', async () => {
    const forged = sign(
      {
        ...claims(),
        sub,
        exp: Date.now() / 1000 + 60,
        iat: (Date.now() / 1000) | 0,
        nbf: (Date.now() / 1000) | 0,
      },
      JSON.stringify(publicJwk),
      {
        algorithm: 'HS256',
        issuer: settings.JWT_ISSUER,
        audience: settings.JWT_AUDIENCE,
      },
    );
    await expect(run(guard, forged)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects alg none', async () => {
    const part = (v: object) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');
    const token = `${part({ alg: 'none' })}.${part({ ...claims(), sub, iss: settings.JWT_ISSUER, aud: settings.JWT_AUDIENCE })}.`;
    await expect(run(guard, token)).rejects.toMatchObject({ status: 401 });
  });
  it('returns 401 when the JWKS is unreachable', async () => {
    const down = new AccessGuard({
      ...settings,
      JWT_JWKS_URI: 'http://127.0.0.1:1/jwks',
    });
    await expect(
      run(down, await rs256(claims(), { alg: 'RS256', kid })),
    ).rejects.toMatchObject({ status: 401 });
  });
});
