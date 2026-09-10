export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_NOT_RUNNABLE'
  | 'EXECUTION_NOT_FOUND'
  | 'CONNECTION_EXPIRED'
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ApiErrorCode | string;
  message: string;
  details?: unknown;
}
