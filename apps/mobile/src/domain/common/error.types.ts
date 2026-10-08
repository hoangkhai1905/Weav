export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_NOT_RUNNABLE'
  | 'EXECUTION_NOT_FOUND'
  | 'CONNECTION_EXPIRED'
  | 'INVALID_STATE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'DRAFT_REVISION_CONFLICT'
  | 'DRAFT_CHANGED'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_BUSY'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'GENERATION_RATE_LIMITED'
  | 'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ApiErrorCode | string;
  message: string;
  details?: unknown;
  status?: number;
  requestId?: string;
}
