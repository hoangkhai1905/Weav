import type { AxiosRequestConfig } from 'axios';
import type {
  CreateWorkflowInput,
  RunWorkflowOptions,
  SaveDraftInput,
  WorkflowListQuery,
} from '../../domain/workflow/workflow.types';
import type { ManualExecutionRequestDto, SaveDraftRequestDto } from './workflow.dto';
import { isUuid } from './notification.http.contract';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);
}

/**
 * A new key per click. The gateway silently DROPS a malformed key (the run would
 * then not be idempotent), so the key is validated here instead.
 */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `run:${hex}`;
}

export function workspaceWorkflowsPath(workspaceId: string): string {
  if (!isUuid(workspaceId)) throw new Error('Invalid workspace id.');
  return `/api/v1/workspaces/${workspaceId}/workflows`;
}

export function workflowPath(workspaceId: string, workflowId: string): string {
  if (!isUuid(workflowId)) throw new Error('Invalid workflow id.');
  return `${workspaceWorkflowsPath(workspaceId)}/${workflowId}`;
}

/** Shared by workflow and execution lists: page >= 0, size 1..100 (gateway limits). */
export function assertPageQuery(query: { page?: number; size?: number }): void {
  if (query.page !== undefined && (!Number.isSafeInteger(query.page) || query.page < 0)) {
    throw new Error('Invalid page.');
  }
  if (
    query.size !== undefined &&
    (!Number.isSafeInteger(query.size) || query.size < 1 || query.size > 100)
  ) {
    throw new Error('Invalid page size.');
  }
}

export function buildPageParams(query: { page?: number; size?: number }) {
  assertPageQuery(query);
  return {
    ...(query.page !== undefined ? { page: query.page } : {}),
    ...(query.size !== undefined ? { size: query.size } : {}),
  };
}

export function buildWorkflowListRequest(
  workspaceId: string,
  query: WorkflowListQuery = {},
  signal?: AbortSignal,
): AxiosRequestConfig {
  return {
    url: workspaceWorkflowsPath(workspaceId),
    params: buildPageParams(query),
    ...(signal ? { signal } : {}),
  };
}

export function buildWorkflowDetailRequest(
  workspaceId: string,
  workflowId: string,
  signal?: AbortSignal,
): AxiosRequestConfig {
  return { url: workflowPath(workspaceId, workflowId), ...(signal ? { signal } : {}) };
}

export function buildPauseWorkflowRequest(
  workspaceId: string,
  workflowId: string,
): AxiosRequestConfig {
  return { method: 'POST', url: `${workflowPath(workspaceId, workflowId)}/pause` };
}

export function buildResumeWorkflowRequest(
  workspaceId: string,
  workflowId: string,
): AxiosRequestConfig {
  return { method: 'POST', url: `${workflowPath(workspaceId, workflowId)}/resume` };
}

/** The gateway body is `{input: {}}` (strict: `input` is required) plus an optional Idempotency-Key header. */
export function buildRunWorkflowRequest(
  workspaceId: string,
  workflowId: string,
  options: RunWorkflowOptions & { idempotencyKey: string },
): AxiosRequestConfig<ManualExecutionRequestDto> {
  if (!isValidIdempotencyKey(options.idempotencyKey)) throw new Error('Invalid idempotency key.');
  return {
    method: 'POST',
    url: `${workflowPath(workspaceId, workflowId)}/executions`,
    data: { input: options.input ?? {} },
    headers: { 'Idempotency-Key': options.idempotencyKey },
  };
}

function assertName(name: string): void {
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 255) {
    throw new Error('Invalid workflow name.');
  }
}

function assertDescription(description: string | undefined): void {
  if (description !== undefined && description.length > 2000) throw new Error('Invalid workflow description.');
}

/** Gateway body is zod .strict(): name 1..255, description <= 2000, nothing else. */
export function buildCreateWorkflowRequest(
  workspaceId: string,
  input: CreateWorkflowInput,
): AxiosRequestConfig<CreateWorkflowInput> {
  assertName(input.name);
  assertDescription(input.description);
  return {
    method: 'POST',
    url: workspaceWorkflowsPath(workspaceId),
    data: {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  };
}

export function buildSaveDraftRequest(
  workspaceId: string,
  workflowId: string,
  input: SaveDraftInput,
): AxiosRequestConfig<SaveDraftRequestDto> {
  assertName(input.name);
  assertDescription(input.description);
  if (
    input.expectedRevision !== undefined &&
    (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
  ) {
    throw new Error('Invalid expected revision.');
  }
  return {
    method: 'PUT',
    url: `${workflowPath(workspaceId, workflowId)}/draft`,
    data: {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      definition: input.definition,
      ...(input.editorState !== undefined ? { editorState: input.editorState } : {}),
      ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
    },
  };
}

export function buildPublishWorkflowRequest(
  workspaceId: string,
  workflowId: string,
): AxiosRequestConfig {
  return { method: 'POST', url: `${workflowPath(workspaceId, workflowId)}/publish` };
}

export function buildDeleteWorkflowRequest(
  workspaceId: string,
  workflowId: string,
): AxiosRequestConfig {
  return { method: 'DELETE', url: workflowPath(workspaceId, workflowId) };
}
