/**
 * OCR API Client
 *
 * Implements the Weav OCR HTTP API contract defined in packages/contracts/http/ocr/openapi.yaml.
 * Sends typed multipart/form-data extraction requests to the API Gateway public route:
 *   POST /api/v1/workspaces/{workspaceId}/ocr/extractions
 *
 * Enforces client pre-validation (media types, 10 MiB size limit) and maps backend
 * error envelopes (ApiErrorEnvelope) to strongly-typed OcrApiError instances.
 */

export type OcrLanguage = 'vi' | 'en' | 'vi+en';

export interface OcrConfig {
  language: OcrLanguage | string;
  detectTables: boolean;
}

export interface PageInfo {
  page: number;
  width: number;
  height: number;
  dpi?: number | null;
}

export interface DocumentInfo {
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | string;
  pages: number;
  pageInfo?: PageInfo[];
}

export interface TextResult {
  rawText: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBlock {
  id: string;
  order: number;
  text: string;
  confidence: number | null;
  page: number;
  boundingBox: BoundingBox;
  polygon?: [number, number][];
}

export interface TableCell {
  row: number;
  column: number;
  rowSpan?: number;
  columnSpan?: number;
  text: string;
  confidence: number | null;
  boundingBox?: BoundingBox | null;
  sourceBlockIds?: string[];
}

export interface TableResult {
  id: string;
  page: number;
  boundingBox: BoundingBox;
  rowCount: number;
  columnCount: number;
  confidence: number | null;
  cells: TableCell[];
}

export interface ExtractionWarning {
  code: string;
  message: string;
  page?: number | null;
  blockId?: string | null;
}

export type OcrQuality = 'OK' | 'LOW_CONFIDENCE' | 'EMPTY';

export interface PreprocessingRecord {
  page: number;
  steps: string[];
}

export interface ExtractionMetadata {
  language: string;
  resolvedLanguage?: string;
  processingTimeMs: number;
  engine?: string;
  engineVersion?: string;
  modelRevision?: string;
  tableDetection?: 'not_requested' | 'completed' | string;
  quality: OcrQuality;
  preprocessing?: PreprocessingRecord[];
  warnings: ExtractionWarning[];
}

export interface OcrExtractionResult {
  schemaVersion: string;
  requestId: string;
  document: DocumentInfo;
  text: TextResult;
  confidence: number | null;
  blocks: TextBlock[];
  tables: TableResult[];
  metadata: ExtractionMetadata;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetail;
  requestId?: string;
}

export class OcrApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;

  constructor(detail: ApiErrorDetail, statusCode?: number, requestId?: string) {
    super(detail.message);
    this.name = 'OcrApiError';
    this.code = detail.code;
    this.retryable = detail.retryable;
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.details = detail.details;
  }
}

export const OCR_SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'];
export const OCR_SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
];
export const OCR_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

export function getOcrApiBaseUrl(): string {
  const envUrl = (
    (typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_API_GATEWAY_URL || import.meta.env.VITE_API_BASE_URL)
      : '') || ''
  ).trim();
  return envUrl.replace(/\/+$/, '');
}

export function getStoredAuthToken(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('weav_token');
    }
  } catch {
    // Non-browser / SSR environment safe
  }
  return null;
}

export function validateOcrFile(file: File): void {
  if (!file) {
    throw new OcrApiError(
      {
        code: 'INVALID_REQUEST',
        message: 'No file provided. Please select a document to extract.',
        retryable: false,
      },
      400
    );
  }

  const fileName = (file.name || '').toLowerCase();
  const fileType = (file.type || '').toLowerCase();
  const hasSupportedExt = OCR_SUPPORTED_EXTENSIONS.some((ext) => fileName.endsWith(ext));
  const hasSupportedMime = OCR_SUPPORTED_MIME_TYPES.includes(fileType);

  if (!hasSupportedExt && !hasSupportedMime) {
    throw new OcrApiError(
      {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Unsupported file media type. Upload a PNG, JPEG, WEBP, or PDF document.',
        retryable: false,
        details: { fileName: file.name, fileType: file.type },
      },
      415
    );
  }

  if (file.size > OCR_MAX_FILE_SIZE_BYTES) {
    throw new OcrApiError(
      {
        code: 'FILE_TOO_LARGE',
        message: 'The uploaded document exceeds the maximum allowable size of 10 MiB.',
        retryable: false,
        details: { limitBytes: OCR_MAX_FILE_SIZE_BYTES, receivedBytes: file.size },
      },
      413
    );
  }
}

export function mapStatusToErrorMessage(status: number): { code: string; message: string; retryable: boolean } {
  switch (status) {
    case 400:
      return { code: 'INVALID_REQUEST', message: 'Invalid request syntax or malformed multipart body.', retryable: false };
    case 401:
      return { code: 'UNAUTHENTICATED', message: 'Authentication required or session expired. Please sign in again.', retryable: false };
    case 403:
      return { code: 'FORBIDDEN', message: 'Access denied. You lack extraction permissions in this workspace.', retryable: false };
    case 404:
      return { code: 'ARTIFACT_NOT_FOUND', message: 'Workspace or target resource not found.', retryable: false };
    case 413:
      return { code: 'FILE_TOO_LARGE', message: 'File size exceeds 10 MiB or page count exceeds 10 pages.', retryable: false };
    case 415:
      return { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported file media type. Must be PNG, JPEG, WEBP, or PDF.', retryable: false };
    case 422:
      return { code: 'CORRUPT_FILE', message: 'Unprocessable document. The file may be corrupt, password-protected, or animated.', retryable: false };
    case 429:
      return { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Please wait a moment before retrying.', retryable: true };
    case 502:
      return { code: 'SOURCE_FETCH_FAILED', message: 'OCR upstream communication failed.', retryable: true };
    case 503:
      return { code: 'OCR_BUSY', message: 'OCR engine is currently busy or models are not yet ready.', retryable: true };
    case 504:
      return { code: 'OCR_TIMEOUT', message: 'OCR processing deadline exceeded.', retryable: true };
    default:
      return { code: 'INTERNAL_ERROR', message: 'Internal OCR processing failure.', retryable: status >= 500 };
  }
}

export interface ExtractTextOptions {
  workspaceId?: string;
  token?: string;
  signal?: AbortSignal;
}

export const ocrApi = {
  async extractText(
    file: File,
    config: OcrConfig,
    options?: ExtractTextOptions
  ): Promise<OcrExtractionResult> {
    // 1. Client-side pre-validation
    validateOcrFile(file);

    const workspaceId = options?.workspaceId || 'ws-main';
    const baseUrl = getOcrApiBaseUrl();
    const endpoint = `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/ocr/extractions`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', config.language || 'vi+en');
    formData.append('detectTables', String(config.detectTables ?? true));

    const token = options?.token ?? getStoredAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const requestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `req-${Date.now()}`;
    headers['X-Request-ID'] = requestId;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: formData,
        signal: options?.signal,
      });
    } catch (networkErr: unknown) {
      if (networkErr instanceof OcrApiError) throw networkErr;
      const isAbort =
        (networkErr instanceof DOMException && networkErr.name === 'AbortError') ||
        (networkErr instanceof Error && networkErr.name === 'AbortError');
      if (isAbort) {
        throw new OcrApiError(
          {
            code: 'REQUEST_TIMEOUT',
            message: 'OCR extraction request timed out or was aborted.',
            retryable: true,
          },
          504,
          requestId
        );
      }
      throw new OcrApiError(
        {
          code: 'OCR_BUSY',
          message: 'Unable to connect to API Gateway. Ensure services are running.',
          retryable: true,
        },
        503,
        requestId
      );
    }

    if (!response.ok) {
      let parsedEnvelope: ApiErrorEnvelope | null = null;
      try {
        parsedEnvelope = (await response.json()) as ApiErrorEnvelope;
      } catch {
        // Response body not JSON
      }

      const statusFallback = mapStatusToErrorMessage(response.status);
      const errCode = parsedEnvelope?.error?.code || statusFallback.code;
      const errMsg = parsedEnvelope?.error?.message || statusFallback.message;
      const retryable =
        typeof parsedEnvelope?.error?.retryable === 'boolean'
          ? parsedEnvelope.error.retryable
          : statusFallback.retryable;
      const responseRequestId =
        parsedEnvelope?.requestId || response.headers.get('x-request-id') || requestId;

      throw new OcrApiError(
        {
          code: errCode,
          message: errMsg,
          retryable,
          details: parsedEnvelope?.error?.details,
        },
        response.status,
        responseRequestId
      );
    }

    const result = (await response.json()) as OcrExtractionResult;
    return result;
  },
};
