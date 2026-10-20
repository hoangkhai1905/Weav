/**
 * Maps a raw run/step error code to a plain-language kind so non-technical users never see codes such as
 * CONNECTION_UNAVAILABLE. The code itself is only shown inside a collapsed "technical details" block.
 * Text lives in i18n as `runerr.<kind>.title` and `runerr.<kind>.hint`.
 */
export type FriendlyErrorKind = 'connection' | 'config' | 'temporary' | 'limit' | 'data' | 'unknown';

/** What the fix button should do: reconnect an account, or open the workflow to fix a step. */
export type FriendlyErrorAction = 'reconnect' | 'open_workflow' | 'none';

const CONNECTION = /^(CONNECTION_|AUTHENTICATION_REJECTED|ACCESS_INVALID|ACCESS_DENIED|PERMISSION_DENIED|UNAUTHORI[SZ]ED|AI_PROVIDER_AUTH)/;
const CONFIG = /^(CONFIGURATION_ERROR|REQUIRED_FIELD_MISSING|MAPPING_ERROR|INVALID_|VALIDATION_ERROR|FORMAT_INVALID|UNKNOWN_|NUMERIC_OPERAND_REQUIRED|OCR_SOURCE_|TRIGGER_|REPLY_MESSAGE_NOT_FOUND)/;
const LIMIT = /^(HTTP_RATE_LIMITED|RATE_LIMIT|RATE_LIMITED|AI_QUOTA_EXCEEDED|AI_PROVIDER_RATE_LIMITED|AI_BUSY|OCR_BUSY|TOO_MANY)/;
const TEMPORARY = /(UNAVAILABLE|TIMEOUT|NETWORK_ERROR|DNS_RESOLUTION_FAILED|WORKER_INTERRUPTED|DEPENDENCY_NOT_CONFIGURED|FETCH_FAILED|INTERNAL_ERROR)/;
const DATA = /^(HTTP_REQUEST_INVALID|HTTP_BUSINESS_REJECTED|HTTP_INVALID_RESPONSE|HTTP_RESPONSE_TOO_LARGE|HTTP_REQUEST_TOO_LARGE|FILE_TOO_LARGE|PAYLOAD_TOO_LARGE|AI_OUTPUT_INVALID|AI_SCHEMA_INVALID|OCR_INVALID_RESPONSE|OCR_HTTP_ERROR|TABLE_EXTRACTION_FAILED|GMAIL_ATTACHMENT_UNREADABLE|OUTPUT_LIMIT_EXCEEDED|FORMAT_RESULT_TOO_LARGE|ATTACHMENT_LIMIT_EXCEEDED)/;

export function friendlyErrorKind(code: string | null | undefined): FriendlyErrorKind {
  const value = (code ?? '').trim().toUpperCase();
  if (!value) return 'unknown';
  if (CONNECTION.test(value)) return 'connection';
  if (LIMIT.test(value)) return 'limit';
  if (DATA.test(value)) return 'data';
  if (CONFIG.test(value)) return 'config';
  if (TEMPORARY.test(value)) return 'temporary';
  return 'unknown';
}

export function friendlyErrorAction(kind: FriendlyErrorKind): FriendlyErrorAction {
  if (kind === 'connection') return 'reconnect';
  if (kind === 'config' || kind === 'data') return 'open_workflow';
  return 'none';
}
