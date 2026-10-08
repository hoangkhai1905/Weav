import type {
  Execution,
  ExecutionLogItem,
  ExecutionLogPage,
  ExecutionPage,
  ExecutionSummary,
  NodeAttempt,
  NodeExecution,
} from '../../domain/execution/execution.types';
import { arr, bool, durationMs, int, oneOf, rec, recOrEmpty, str, strOrNull } from './mapper-utils';

const STATUSES = ['QUEUED', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
const TRIGGERS = ['MANUAL', 'SCHEDULE', 'WEBHOOK', 'TELEGRAM', 'GMAIL'] as const;
const NODE_STATUSES = [
  'PENDING',
  'READY',
  'RUNNING',
  'WAITING',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
] as const;
const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export function mapExecutionSummary(value: unknown): ExecutionSummary {
  const r = rec(value, 'execution');
  const startedAt = strOrNull(r, 'startedAt', 'execution');
  const finishedAt = strOrNull(r, 'finishedAt', 'execution');
  return {
    executionId: str(r, 'executionId', 'execution'),
    workflowId: str(r, 'workflowId', 'execution'),
    workflowVersionId: str(r, 'workflowVersionId', 'execution'),
    status: oneOf(r, 'status', STATUSES, 'execution'),
    triggerType: oneOf(r, 'triggerType', TRIGGERS, 'execution'),
    createdAt: str(r, 'createdAt', 'execution'),
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt),
  };
}

export function mapExecutionPage(value: unknown): ExecutionPage {
  const r = rec(value, 'executionPage');
  return {
    items: arr(r, 'items', 'executionPage').map(mapExecutionSummary),
    page: int(r, 'page', 'executionPage'),
    size: int(r, 'size', 'executionPage'),
    totalElements: int(r, 'totalElements', 'executionPage'),
    hasNext: bool(r, 'hasNext', 'executionPage'),
  };
}

function mapAttempt(value: unknown): NodeAttempt {
  const r = rec(value, 'attempt');
  return {
    attemptId: str(r, 'attemptId', 'attempt'),
    attemptNumber: int(r, 'attemptNumber', 'attempt'),
    status: str(r, 'status', 'attempt'),
    startedAt: strOrNull(r, 'startedAt', 'attempt'),
    finishedAt: strOrNull(r, 'finishedAt', 'attempt'),
    output: r.output ?? null,
    error: r.error ?? null,
  };
}

function mapNode(value: unknown): NodeExecution {
  const r = rec(value, 'node');
  const startedAt = strOrNull(r, 'startedAt', 'node');
  const finishedAt = strOrNull(r, 'finishedAt', 'node');
  return {
    nodeExecutionId: str(r, 'nodeExecutionId', 'node'),
    nodeId: str(r, 'nodeId', 'node'),
    nodeType: str(r, 'nodeType', 'node'),
    status: oneOf(r, 'status', NODE_STATUSES, 'node'),
    attemptCount: int(r, 'attemptCount', 'node'),
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt),
    output: r.output ?? null,
    error: r.error ?? null,
    attempts: arr(r, 'attempts', 'node').map(mapAttempt),
  };
}

function mapLog(value: unknown): ExecutionLogItem {
  const r = rec(value, 'log');
  return {
    id: str(r, 'id', 'log'),
    nodeExecutionId: strOrNull(r, 'nodeExecutionId', 'log'),
    attemptId: strOrNull(r, 'attemptId', 'log'),
    level: oneOf(r, 'level', LEVELS, 'log'),
    eventType: str(r, 'eventType', 'log'),
    message: strOrNull(r, 'message', 'log'),
    metadata: recOrEmpty(r.metadata),
    createdAt: str(r, 'createdAt', 'log'),
  };
}

function mapLogPage(value: unknown): ExecutionLogPage {
  const r = rec(value, 'logPage');
  return {
    items: arr(r, 'items', 'logPage').map(mapLog),
    page: int(r, 'page', 'logPage'),
    size: int(r, 'size', 'logPage'),
    totalElements: int(r, 'totalElements', 'logPage'),
    hasNext: bool(r, 'hasNext', 'logPage'),
  };
}

export function mapExecution(value: unknown): Execution {
  const r = rec(value, 'execution');
  return {
    ...mapExecutionSummary(value),
    nodes: arr(r, 'nodes', 'execution').map(mapNode),
    logs: mapLogPage(r.logs),
  };
}
