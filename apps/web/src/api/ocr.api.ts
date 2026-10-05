import { tr } from '../lib/i18n/tr';
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
        message: tr('msg.no_file_provided_please_select_a_document'),
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
        message: tr('msg.unsupported_file_media_type_upload_a_png'),
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
        message: tr('msg.the_uploaded_document_exceeds_the_maximum_allowable'),
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
      return { code: 'INVALID_REQUEST', message: tr('msg.invalid_request_syntax_or_malformed_multipart_body'), retryable: false };
    case 401:
      return { code: 'UNAUTHENTICATED', message: tr('msg.authentication_required_or_session_expired_please_sign'), retryable: false };
    case 403:
      return { code: 'FORBIDDEN', message: tr('msg.access_denied_you_lack_extraction_permissions_in'), retryable: false };
    case 404:
      return { code: 'ARTIFACT_NOT_FOUND', message: tr('msg.workspace_or_target_resource_not_found'), retryable: false };
    case 413:
      return { code: 'FILE_TOO_LARGE', message: tr('msg.file_size_exceeds_10_mib_or_page'), retryable: false };
    case 415:
      return { code: 'UNSUPPORTED_MEDIA_TYPE', message: tr('msg.unsupported_file_media_type_must_be_png'), retryable: false };
    case 422:
      return { code: 'CORRUPT_FILE', message: tr('msg.unprocessable_document_the_file_may_be_corrupt'), retryable: false };
    case 429:
      return { code: 'RATE_LIMITED', message: tr('msg.rate_limit_exceeded_please_wait_a_moment'), retryable: true };
    case 502:
      return { code: 'SOURCE_FETCH_FAILED', message: tr('msg.ocr_upstream_communication_failed'), retryable: true };
    case 503:
      return { code: 'OCR_BUSY', message: tr('msg.ocr_engine_is_currently_busy_or_models'), retryable: true };
    case 504:
      return { code: 'OCR_TIMEOUT', message: tr('msg.ocr_processing_deadline_exceeded'), retryable: true };
    default:
      return { code: 'INTERNAL_ERROR', message: tr('msg.internal_ocr_processing_failure'), retryable: status >= 500 };
  }
}

export interface ExtractTextOptions {
  workspaceId: string;
  token?: string;
  signal?: AbortSignal;
}

export const ocrApi = {
  async extractText(
    file: File,
    config: OcrConfig,
    options: ExtractTextOptions
  ): Promise<OcrExtractionResult> {
    // 1. Client-side pre-validation
    validateOcrFile(file);

    const workspaceId = options.workspaceId.trim();
    if (!workspaceId) {
      throw new OcrApiError(
        {
          code: 'WORKSPACE_REQUIRED',
          message: tr('msg.select_a_workspace_before_uploading_a_document'),
          retryable: false,
        },
        400
      );
    }
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
            message: tr('msg.ocr_extraction_request_timed_out_or_was'),
            retryable: true,
          },
          504,
          requestId
        );
      }
      throw new OcrApiError(
        {
          code: 'OCR_BUSY',
          message: tr('msg.unable_to_connect_to_api_gateway_ensure'),
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
