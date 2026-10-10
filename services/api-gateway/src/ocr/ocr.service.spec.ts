/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, Logger } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { OcrService } from './ocr.service';

describe('OcrService (Proxy Boundary)', () => {
  let service: OcrService;
  let mockFetch: jest.Mock; // OCR upstream
  let workspaceFetch: jest.Mock; // Workspace Service membership check
  let mockConfigService: { get: jest.Mock };

  const DEFAULT_OCR_URL = 'http://ocr-service:8000';
  const WORKSPACE_URL = 'http://workspace-service:8080';
  const VALID_WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const KEY_ID = 'gateway-test-1';

  let keyDir: string;
  let keyFile: string;
  let publicKeyPem: string;

  // Gateway config with a signing key, as production would have it.
  const gatewayConfig = (overrides: Record<string, unknown> = {}) => ({
    appEnv: 'production',
    upstreams: { ocr: DEFAULT_OCR_URL, workspace: WORKSPACE_URL },
    ocr: {
      allowUnauthenticatedDev: false,
      timeoutMs: 10_000,
      signingKeyLocation: keyFile,
      signingKeyId: KEY_ID,
      ...overrides,
    },
  });

  beforeAll(() => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    keyDir = mkdtempSync(join(tmpdir(), 'ocr-key-'));
    keyFile = join(keyDir, 'api-gateway.pem');
    writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  });

  afterAll(() => rmSync(keyDir, { recursive: true, force: true }));

  beforeEach(async () => {
    mockFetch = jest.fn();
    // Default: the caller is a member of the workspace.
    workspaceFetch = jest.fn(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const routedFetch = jest.fn((url: string, init: RequestInit) =>
      String(url).startsWith(WORKSPACE_URL)
        ? workspaceFetch(url, init)
        : mockFetch(url, init),
    );

    // Default configuration: production environment, dev bypass disabled, signing key set
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        switch (key) {
          case 'gateway':
            return gatewayConfig();
          case 'OCR_SERVICE_URL':
            return DEFAULT_OCR_URL;
          case 'APP_ENV':
            return 'production';
          case 'OCR_ALLOW_UNAUTHENTICATED_DEV':
            return 'false';
          default:
            return defaultValue;
        }
      }),
    };

    // Global fetch fallback seam to guarantee no real network calls occur
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: 'FETCH_FN',
          useValue: routedFetch,
        },
      ],
    }).compile();

    service = module.get<OcrService>(OcrService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Multipart body and content-type forwarding', () => {
    it('should forward multipart/form-data body stream and content-type with boundary to OCR_SERVICE_URL/v1/extractions', async () => {
      const upstreamResponse = {
        schemaVersion: '1.0',
        requestId: 'c4e97654-20a2-4a0b-93df-595304b49eb1',
        document: {
          fileName: 'test.png',
          mimeType: 'image/png',
          pages: 1,
          pageInfo: [],
        },
        text: { rawText: 'Hello OCR' },
        confidence: 0.98,
        blocks: [],
        tables: [],
        metadata: {
          language: 'vi+en',
          resolvedLanguage: 'vi',
          processingTimeMs: 120,
          engine: 'paddleocr',
          engineVersion: '3.7.0',
          modelRevision: 'rev-1',
          tableDetection: 'not_requested',
          quality: 'OK',
          preprocessing: [],
          warnings: [],
        },
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(upstreamResponse), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'c4e97654-20a2-4a0b-93df-595304b49eb1',
          },
        }),
      );

      const multipartContentType =
        'multipart/form-data; boundary=----WebKitFormBoundaryXyZ123';
      const bodyStream = Readable.from([Buffer.from('fake multipart chunk')]);

      const req = {
        headers: {
          'content-type': multipartContentType,
          authorization: 'Bearer valid-jwt-token',
          'x-request-id': 'c4e97654-20a2-4a0b-93df-595304b49eb1',
        },
        body: bodyStream,
        raw: bodyStream,
      };

      const result = await service.proxyExtraction(VALID_WORKSPACE_ID, req);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(DEFAULT_OCR_URL + '/v1/extractions');
      expect(init.method).toBe('POST');
      expect(init.headers['content-type']).toBe(multipartContentType);
      expect(init.headers['x-workspace-id']).toBe(VALID_WORKSPACE_ID);
      expect(init.headers['x-request-id']).toBe(
        'c4e97654-20a2-4a0b-93df-595304b49eb1',
      );
      expect(init.body).toBeDefined();
      if (init.duplex) {
        expect(init.duplex).toBe('half');
      }

      expect(result.status).toBe(200);
      expect(result.data).toEqual(
        expect.objectContaining({ schemaVersion: '1.0' }),
      );
    });
  });

  describe('Upload size cap', () => {
    const CAP = 10 * 1024 * 1024 + 64 * 1024;
    const multipart = 'multipart/form-data; boundary=----cap';

    it('rejects a declared length over the cap with 413 and never calls upstream', async () => {
      const stream = Readable.from([Buffer.from('x')]);
      const result = await service.proxyExtraction(VALID_WORKSPACE_ID, {
        headers: {
          'content-type': multipart,
          authorization: 'Bearer t',
          'content-length': String(CAP + 1),
        },
        body: stream,
        raw: stream,
      });
      expect(result.status).toBe(413);
      expect((result.data as any).error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a chunked stream that grows past the cap with 413', async () => {
      mockFetch.mockImplementationOnce(async (_url: string, init: any) => {
        for await (const chunk of init.body) void chunk;
        return new Response('{}', {
          headers: { 'content-type': 'application/json' },
        });
      });
      const chunks = [Buffer.alloc(CAP), Buffer.alloc(1)];
      const stream = Readable.from(chunks);
      const result = await service.proxyExtraction(VALID_WORKSPACE_ID, {
        headers: { 'content-type': multipart, authorization: 'Bearer t' },
        body: stream,
        raw: stream,
      });
      expect(result.status).toBe(413);
    });

    it('proxies an upload exactly at the cap', async () => {
      mockFetch.mockImplementationOnce(async (_url: string, init: any) => {
        for await (const chunk of init.body) void chunk;
        return new Response('{"ok":true}', {
          headers: { 'content-type': 'application/json' },
        });
      });
      const stream = Readable.from([Buffer.alloc(CAP)]);
      const result = await service.proxyExtraction(VALID_WORKSPACE_ID, {
        headers: {
          'content-type': multipart,
          authorization: 'Bearer t',
          'content-length': String(CAP),
        },
        body: stream,
        raw: stream,
      });
      expect(result.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('JSON body forwarding', () => {
    it('should forward application/json body and content-type to OCR_SERVICE_URL/v1/extractions', async () => {
      const upstreamResponse = {
        schemaVersion: '1.0',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        document: {
          fileName: 'artifact.pdf',
          mimeType: 'application/pdf',
          pages: 1,
          pageInfo: [],
        },
        text: { rawText: 'Artifact content' },
        confidence: 0.95,
        blocks: [],
        tables: [],
        metadata: {
          language: 'en',
          resolvedLanguage: 'en',
          processingTimeMs: 200,
          engine: 'paddleocr',
          engineVersion: '3.7.0',
          modelRevision: 'rev-1',
          tableDetection: 'completed',
          quality: 'OK',
          preprocessing: [],
          warnings: [],
        },
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(upstreamResponse), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': '550e8400-e29b-41d4-a716-446655440000',
          },
        }),
      );

      const jsonPayload = {
        source: {
          type: 'artifact',
          artifactId: 'a8b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        },
        language: 'en',
        detectTables: true,
      };

      const req = {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer valid-jwt-token',
          'x-request-id': '550e8400-e29b-41d4-a716-446655440000',
        },
        body: jsonPayload,
      };

      const result = await service.proxyExtraction(VALID_WORKSPACE_ID, req);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(DEFAULT_OCR_URL + '/v1/extractions');
      expect(init.method).toBe('POST');
      expect(init.headers['content-type']).toBe('application/json');
      expect(init.headers['x-workspace-id']).toBe(VALID_WORKSPACE_ID);

      const parsedSentBody =
        typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      expect(parsedSentBody).toEqual(jsonPayload);
      expect(result.status).toBe(200);
    });
  });

  describe('Header forwarding & correlation ID generation', () => {
    it('should forward workspace ID as X-Workspace-ID and preserve incoming X-Request-ID and traceparent', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ schemaVersion: '1.0' }), {
          status: 200,
          headers: { 'x-request-id': 'client-provided-req-id' },
        }),
      );

      const req = {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123',
          'x-request-id': 'client-provided-req-id',
          traceparent:
            '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        },
        body: {
          source: { type: 'url', fileUrl: 'https://files.example.com/doc.png' },
        },
      };

      await service.proxyExtraction(VALID_WORKSPACE_ID, req);

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['x-workspace-id']).toBe(VALID_WORKSPACE_ID);
      expect(init.headers['x-request-id']).toBe('client-provided-req-id');
      expect(init.headers['traceparent']).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    it('should generate a valid UUID correlation ID when X-Request-ID is not provided by caller', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ schemaVersion: '1.0' }), {
          status: 200,
        }),
      );

      const req = {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123',
        },
        body: {
          source: { type: 'url', fileUrl: 'https://files.example.com/doc.png' },
        },
      };

      await service.proxyExtraction(VALID_WORKSPACE_ID, req);

      const [, init] = mockFetch.mock.calls[0];
      const generatedRequestId = init.headers['x-request-id'];
      expect(generatedRequestId).toBeDefined();
      expect(generatedRequestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('Service JWT minting and log redaction', () => {
    const upstreamOk = () =>
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 });
    const jsonReq = (authorization?: string) => ({
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
        'x-request-id': 'req-service-jwt',
      },
      body: {
        source: {
          type: 'artifact',
          artifactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        },
      },
    });
    const useGateway = (overrides: Record<string, unknown>, appEnv?: string) =>
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'gateway'
          ? { ...gatewayConfig(overrides), ...(appEnv ? { appEnv } : {}) }
          : undefined,
      );

    it('sends a short-lived RS256 Service JWT instead of the user token, without logging either', async () => {
      const secretToken = 'super-secret-bearer-jwt-token-to-never-log-12345';
      mockFetch.mockResolvedValueOnce(upstreamOk());

      const spies = [
        jest.spyOn(Logger.prototype, 'log').mockImplementation(),
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
        jest.spyOn(Logger.prototype, 'error').mockImplementation(),
        jest.spyOn(Logger.prototype, 'debug').mockImplementation(),
        jest.spyOn(Logger.prototype, 'verbose').mockImplementation(),
        jest.spyOn(console, 'log').mockImplementation(),
        jest.spyOn(console, 'warn').mockImplementation(),
        jest.spyOn(console, 'error').mockImplementation(),
      ];

      await service.proxyExtraction(
        VALID_WORKSPACE_ID,
        jsonReq(`Bearer ${secretToken}`),
      );

      const [, init] = mockFetch.mock.calls[0];
      const sent: string = init.headers['authorization'];
      expect(sent).toMatch(/^Bearer \S+$/);
      expect(sent).not.toContain(secretToken);
      const token = sent.slice('Bearer '.length);

      expect(decodeProtectedHeader(token)).toMatchObject({
        alg: 'RS256',
        kid: KEY_ID,
      });
      const { payload } = await jwtVerify(
        token,
        await importSPKI(publicKeyPem, 'RS256'),
        {
          issuer: 'weav-api-gateway',
          audience: 'weav-ocr',
          algorithms: ['RS256'],
        },
      );
      expect(payload.scope).toBe('ocr:extract');
      expect(payload.mode).toBe('preview');
      expect(payload.workspace_id).toBe(VALID_WORKSPACE_ID);
      expect(payload.exp! - payload.iat!).toBe(60);
      expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);

      for (const spy of spies) {
        for (const callArgs of spy.mock.calls) {
          const serialized = JSON.stringify(callArgs);
          expect(serialized).not.toContain(secretToken);
          expect(serialized).not.toContain(token);
        }
      }
    });

    it('mints a distinct jti for every request', async () => {
      mockFetch
        .mockResolvedValueOnce(upstreamOk())
        .mockResolvedValueOnce(upstreamOk());
      await service.proxyExtraction(VALID_WORKSPACE_ID, jsonReq('Bearer u'));
      await service.proxyExtraction(VALID_WORKSPACE_ID, jsonReq('Bearer u'));
      const jtis = mockFetch.mock.calls.map(
        ([, init]) =>
          JSON.parse(
            Buffer.from(
              init.headers.authorization.split('.')[1],
              'base64url',
            ).toString(),
          ).jti,
      );
      expect(new Set(jtis).size).toBe(2);
    });

    it('fails closed with a sanitized 503 and logs once when the key file is unreadable', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      useGateway({ signingKeyLocation: join(keyDir, 'missing.pem') });

      for (let i = 0; i < 2; i += 1) {
        const res = await service.proxyExtraction(
          VALID_WORKSPACE_ID,
          jsonReq('Bearer u'),
        );
        expect(res.status).toBe(503);
        expect((res.data as any).error.code).toBe('OCR_BUSY');
        expect(JSON.stringify(res.data)).not.toContain('missing.pem');
      }
      expect(mockFetch).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('fails closed with 503 when the key file is not a PKCS#8 PEM', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const bad = join(keyDir, 'bad.pem');
      writeFileSync(bad, 'not a key');
      useGateway({ signingKeyLocation: bad });
      const res = await service.proxyExtraction(
        VALID_WORKSPACE_ID,
        jsonReq('Bearer u'),
      );
      expect(res.status).toBe(503);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fails closed with 503 when no key is configured outside the dev bypass', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      useGateway({ signingKeyLocation: undefined });
      const res = await service.proxyExtraction(
        VALID_WORKSPACE_ID,
        jsonReq('Bearer user-token'),
      );
      expect(res.status).toBe(503);
      expect((res.data as any).error.code).toBe('OCR_BUSY');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    describe('workspace membership', () => {
      it('checks membership with the caller token only at Workspace Service, then mints for OCR', async () => {
        mockFetch.mockResolvedValueOnce(upstreamOk());
        const res = await service.proxyExtraction(
          VALID_WORKSPACE_ID,
          jsonReq('Bearer user-token'),
        );
        expect(res.status).toBe(200);

        expect(workspaceFetch).toHaveBeenCalledTimes(1);
        const [wsUrl, wsInit] = workspaceFetch.mock.calls[0];
        expect(wsUrl).toBe(`${WORKSPACE_URL}/workspaces/${VALID_WORKSPACE_ID}`);
        expect(wsInit.method).toBe('GET');
        expect(wsInit.redirect).toBe('error');
        expect(wsInit.headers.authorization).toBe('Bearer user-token');
        expect(wsInit.headers['x-request-id']).toBe('req-service-jwt');
        expect(wsInit.headers['x-correlation-id']).toBe('req-service-jwt');

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, ocrInit] = mockFetch.mock.calls[0];
        expect(ocrInit.headers.authorization).toMatch(/^Bearer \S+$/);
        expect(ocrInit.headers.authorization).not.toContain('user-token');
      });

      it.each([403, 404])(
        'returns 403 FORBIDDEN and never mints or calls OCR when Workspace Service says %s',
        async (status) => {
          workspaceFetch.mockResolvedValueOnce(
            new Response('{"secret":"x"}', { status }),
          );
          const res = await service.proxyExtraction(
            VALID_WORKSPACE_ID,
            jsonReq('Bearer user-token'),
          );
          expect(res.status).toBe(403);
          expect((res.data as any).error.code).toBe('FORBIDDEN');
          expect((res.data as any).error.retryable).toBe(false);
          expect((res.data as any).requestId).toBe('req-service-jwt');
          expect(JSON.stringify(res.data)).not.toContain('secret');
          expect(mockFetch).not.toHaveBeenCalled();
        },
      );

      it('returns the sanitized 503 and never calls OCR when Workspace Service answers 500', async () => {
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
        workspaceFetch.mockResolvedValueOnce(
          new Response('boom', { status: 500 }),
        );
        const res = await service.proxyExtraction(
          VALID_WORKSPACE_ID,
          jsonReq('Bearer user-token'),
        );
        expect(res.status).toBe(503);
        expect((res.data as any).error.code).toBe('OCR_BUSY');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('returns the sanitized 503 and never calls OCR when the membership call fails or times out', async () => {
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();
        workspaceFetch.mockRejectedValueOnce(new TypeError('ECONNREFUSED'));
        const failed = await service.proxyExtraction(
          VALID_WORKSPACE_ID,
          jsonReq('Bearer user-token'),
        );
        expect(failed.status).toBe(503);

        jest.useFakeTimers();
        try {
          workspaceFetch.mockImplementationOnce(
            (_url: string, init: { signal: AbortSignal }) =>
              new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () =>
                  reject(new Error('aborted')),
                );
              }),
          );
          const pending = service.proxyExtraction(
            VALID_WORKSPACE_ID,
            jsonReq('Bearer user-token'),
          );
          await jest.advanceTimersByTimeAsync(5_001);
          const timedOut = await pending;
          expect(timedOut.status).toBe(503);
        } finally {
          jest.useRealTimers();
        }

        expect(mockFetch).not.toHaveBeenCalled();
        for (const call of errorSpy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain('user-token');
        }
      });

      it('skips the membership call on the dev-bypass path without a key', async () => {
        useGateway(
          { signingKeyLocation: undefined, allowUnauthenticatedDev: true },
          'development',
        );
        mockFetch.mockResolvedValueOnce(upstreamOk());
        await service.proxyExtraction(
          VALID_WORKSPACE_ID,
          jsonReq('Bearer user-token'),
        );
        expect(workspaceFetch).not.toHaveBeenCalled();
      });
    });

    it('sends no Authorization at all (not the user token) when the dev bypass is on and no key is set', async () => {
      useGateway(
        { signingKeyLocation: undefined, allowUnauthenticatedDev: true },
        'development',
      );
      mockFetch.mockResolvedValueOnce(upstreamOk());
      const res = await service.proxyExtraction(
        VALID_WORKSPACE_ID,
        jsonReq('Bearer user-token'),
      );
      expect(res.status).toBe(200);
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers).not.toHaveProperty('authorization');
    });
  });

  describe('Authorization enforcement and development bypass', () => {
    it('should reject with 401 when Authorization header is missing outside explicit development bypass', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'production';
        if (key === 'OCR_ALLOW_UNAUTHENTICATED_DEV') return 'false';
        if (key === 'OCR_SERVICE_URL') return DEFAULT_OCR_URL;
        return undefined;
      });

      const req = {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-no-auth',
        },
        body: {
          source: {
            type: 'artifact',
            artifactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          },
        },
      };

      try {
        const result = await service.proxyExtraction(VALID_WORKSPACE_ID, req);
        expect(result.status).toBe(401);
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(401);
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject with 401 when APP_ENV is development but OCR_ALLOW_UNAUTHENTICATED_DEV is false', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'development';
        if (key === 'OCR_ALLOW_UNAUTHENTICATED_DEV') return 'false';
        if (key === 'OCR_SERVICE_URL') return DEFAULT_OCR_URL;
        return undefined;
      });

      const req = {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-no-dev-bypass',
        },
        body: {
          source: {
            type: 'artifact',
            artifactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          },
        },
      };

      try {
        const result = await service.proxyExtraction(VALID_WORKSPACE_ID, req);
        expect(result.status).toBe(401);
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(401);
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should allow unauthenticated request when APP_ENV is development AND OCR_ALLOW_UNAUTHENTICATED_DEV is true', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'development';
        if (key === 'OCR_ALLOW_UNAUTHENTICATED_DEV') return 'true';
        if (key === 'OCR_SERVICE_URL') return DEFAULT_OCR_URL;
        return undefined;
      });

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schemaVersion: '1.0',
            text: { rawText: 'dev bypass ok' },
          }),
          {
            status: 200,
            headers: { 'x-request-id': 'req-dev-ok' },
          },
        ),
      );

      const req = {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-dev-ok',
        },
        body: {
          source: {
            type: 'artifact',
            artifactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          },
        },
      };

      const result = await service.proxyExtraction(VALID_WORKSPACE_ID, req);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(200);
      expect(result.data).toEqual(
        expect.objectContaining({ schemaVersion: '1.0' }),
      );
    });
  });

  describe('Upstream status, body, and X-Request-ID preservation', () => {
    it('should preserve upstream success status (200), response body, and X-Request-ID header', async () => {
      const upstreamBody = {
        schemaVersion: '1.0',
        requestId: 'preserve-id-200',
        document: {
          fileName: 'sample.png',
          mimeType: 'image/png',
          pages: 1,
          pageInfo: [],
        },
        text: { rawText: 'Sample text' },
        confidence: 0.99,
        blocks: [],
        tables: [],
        metadata: { quality: 'OK' },
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(upstreamBody), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'preserve-id-200',
          },
        }),
      );

      const req = {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token',
          'x-request-id': 'preserve-id-200',
        },
        body: {
          source: { type: 'url', fileUrl: 'https://files.example.com/doc.png' },
        },
      };

      const result = await service.proxyExtraction(VALID_WORKSPACE_ID, req);

      expect(result.status).toBe(200);
      expect(result.headers['x-request-id']).toBe('preserve-id-200');
      expect(result.data).toEqual(upstreamBody);
    });

    it('should preserve upstream error status (422) and error envelope payload', async () => {
      const upstreamError = {
        error: {
          code: 'CORRUPT_FILE',
          message: 'The uploaded file is corrupt or unreadable',
          retryable: false,
        },
        requestId: 'err-preserve-422',
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(upstreamError), {
          status: 422,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'err-preserve-422',
          },
        }),
      );

      const req = {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token',
          'x-request-id': 'err-preserve-422',
        },
        body: {
          source: { type: 'url', fileUrl: 'https://files.example.com/bad.png' },
        },
      };

      const result = await service.proxyExtraction(VALID_WORKSPACE_ID, req);

      expect(result.status).toBe(422);
      expect(result.headers['x-request-id']).toBe('err-preserve-422');
      expect(result.data).toEqual(upstreamError);
    });
  });

  describe('Sanitized 503 on upstream connection failure', () => {
    it('should return sanitized 503 ApiErrorEnvelope when upstream connection fails', async () => {
      mockFetch.mockRejectedValueOnce(
        new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:8000'),
      );

      const req = {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token',
          'x-request-id': 'req-503-test',
        },
        body: {
          source: {
            type: 'artifact',
            artifactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          },
        },
      };

      let status = 0;
      let data: any = null;

      try {
        const res = await service.proxyExtraction(VALID_WORKSPACE_ID, req);
        status = res.status;
        data = res.data;
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        status = err.getStatus();
        data = err.getResponse();
      }

      expect(status).toBe(503);
      expect(data).toBeDefined();
      expect(data.error).toBeDefined();
      expect(data.error.code).toMatch(
        /^(OCR_BUSY|MODEL_NOT_READY|SERVICE_UNAVAILABLE)$/,
      );
      expect(data.error.message).toBeDefined();
      expect(data.error.retryable).toBe(true);
      expect(data.requestId).toBeDefined();

      // Must sanitize internal error details: no socket errors or raw URLs leaked
      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain('ECONNREFUSED');
      expect(serialized).not.toContain('127.0.0.1:8000');
      expect(serialized).not.toContain('fetch failed');
    });
  });

  describe('Configurable upstream deadline', () => {
    it('aborts the upstream call at gateway.ocr.timeoutMs and returns sanitized 503 OCR_BUSY', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'gateway' ? gatewayConfig({ timeoutMs: 50 }) : undefined,
      );
      // Never resolves; only rejects when the gateway deadline aborts the signal.
      mockFetch.mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      );

      const startedAt = Date.now();
      const res = await service.proxyExtraction(VALID_WORKSPACE_ID, {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token',
        },
        body: {
          source: {
            type: 'artifact',
            artifactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          },
        },
      });

      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(res.status).toBe(503);
      expect((res.data as any).error.code).toBe('OCR_BUSY');
      expect((res.data as any).error.retryable).toBe(true);
    });
  });

  describe('Workspace ID validation', () => {
    it('should reject request when workspaceId is missing or empty', async () => {
      const req = {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token',
        },
        body: {
          source: {
            type: 'artifact',
            artifactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          },
        },
      };

      try {
        const result = await service.proxyExtraction('', req);
        expect(result.status).toBe(400);
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(400);
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
