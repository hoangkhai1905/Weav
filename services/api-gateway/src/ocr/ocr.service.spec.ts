/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { OcrService } from './ocr.service';

describe('OcrService (Proxy Boundary)', () => {
  let service: OcrService;
  let mockFetch: jest.Mock;
  let mockConfigService: { get: jest.Mock };

  const DEFAULT_OCR_URL = 'http://ocr-service:8000';
  const VALID_WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

  beforeEach(async () => {
    mockFetch = jest.fn();

    // Default configuration: production environment, dev bypass disabled
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        switch (key) {
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
          useValue: mockFetch,
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

  describe('Authorization forwarding and log redaction', () => {
    it('should forward Authorization Bearer token to upstream without logging the token', async () => {
      const secretToken = 'super-secret-bearer-jwt-token-to-never-log-12345';
      const authHeader = `Bearer ${secretToken}`;

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ schemaVersion: '1.0' }), {
          status: 200,
        }),
      );

      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const debugSpy = jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation();
      const verboseSpy = jest
        .spyOn(Logger.prototype, 'verbose')
        .mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const req = {
        headers: {
          'content-type': 'application/json',
          authorization: authHeader,
          'x-request-id': 'req-redaction-test',
        },
        body: {
          source: {
            type: 'artifact',
            artifactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          },
        },
      };

      await service.proxyExtraction(VALID_WORKSPACE_ID, req);

      // Verify token was forwarded to upstream
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['authorization']).toBe(authHeader);

      // Verify token was never logged
      const allSpies = [
        logSpy,
        warnSpy,
        errorSpy,
        debugSpy,
        verboseSpy,
        consoleLogSpy,
        consoleWarnSpy,
        consoleErrorSpy,
      ];
      for (const spy of allSpies) {
        for (const callArgs of spy.mock.calls) {
          const serialized = JSON.stringify(callArgs);
          expect(serialized).not.toContain(secretToken);
        }
      }
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
