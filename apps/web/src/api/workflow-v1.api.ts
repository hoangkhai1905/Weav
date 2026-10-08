import type { WorkflowDefinition, WorkflowEdge, WorkflowNode, WorkflowStatus } from '../types/workflow.types';
import { tr } from '../lib/i18n/tr';
import { primaryTrigger } from '../lib/executions/runView';
import { useAuthStore } from '../store/useAuthStore';

const ACTIVE_WORKSPACE_KEY = 'weav_active_workspace_id';
const PAGE_SIZE = 100;

export class WorkflowApiError extends Error {
  readonly status: number;
  /** Validation details of a 400 (`field` + "CODE: message"); empty for other errors. */
  readonly details: Array<{ field?: string; message?: string }>;

  constructor(
    status: number,
    message: string,
    details: Array<{ field?: string; message?: string }> = [],
  ) {
    super(message);
    this.name = 'WorkflowApiError';
    this.status = status;
    this.details = details;
  }
}

export interface WorkflowRunReceipt {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  status: 'QUEUED';
}

export interface WebhookProvisioning {
  triggerId: string;
  endpointKey: string;
  secret: string;
}

export interface WorkflowPublication {
  workflow: WorkflowDefinition;
  webhooks: WebhookProvisioning[];
}

interface WorkflowSummaryV1 {
  workflowId: string;
  name: string;
  description?: string | null;
  status: WorkflowStatus;
  schemaVersion?: string;
  currentVersionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
  /** Node types of every trigger node, in definition order. */
  triggerTypes?: string[];
}

interface WorkflowDetailV1 extends WorkflowSummaryV1 {
  definition?: unknown;
  editorState?: unknown;
}

interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
}

export interface WorkflowExecutionSummaryV1 {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  status: 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  triggerType: 'MANUAL' | 'SCHEDULE' | 'WEBHOOK' | 'TELEGRAM';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface WorkflowExecutionDetailV1 extends WorkflowExecutionSummaryV1 {
  nodes: Array<{
    nodeExecutionId: string;
    nodeId: string;
    nodeType: string;
    status: 'PENDING' | 'READY' | 'RUNNING' | 'WAITING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
    attemptCount: number;
    startedAt: string | null;
    finishedAt: string | null;
    output: unknown;
    error: unknown;
    attempts: Array<{
      attemptId: string;
      attemptNumber: number;
      status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
      startedAt: string;
      finishedAt: string | null;
      output: unknown;
      error: unknown;
    }>;
  }>;
  logs: {
    items: Array<{
      id: string;
      nodeExecutionId: string | null;
      attemptId: string | null;
      level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
      eventType: string;
      message: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>;
    page: number;
    size: number;
    totalElements: number;
    hasNext: boolean;
  };
}

interface WorkspaceSummary {
  id: string;
  name: string;
}

interface WorkflowDefinitionV1 {
  schemaVersion: '1.0';
  nodes: Array<{ id: string; type: string; config: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourcePort?: string }>;
  variables: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function apiBaseUrl(): string {
  return (
    import.meta.env.VITE_API_GATEWAY_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

function authToken(): string {
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem('weav_token');
  if (!token) throw new WorkflowApiError(401, tr('msg.sign_in_to_access_workflows'));
  return token;
}

const DETAIL_CACHE_MS = 5_000;
const detailCache = new Map<string, { at: number; promise: Promise<WorkflowDetailV1> }>();

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Any write invalidates cached workflow details.
  if (init.method && init.method !== 'GET') detailCache.clear();
  const token = localStorage.getItem('weav_token');
  try {
    return await requestOnce<T>(path, init);
  } catch (error) {
    if (!(error instanceof WorkflowApiError) || error.status !== 401) throw error;
    // Another call may already have renewed the token; otherwise renew it once, then retry.
    if (localStorage.getItem('weav_token') === token
      && !(await useAuthStore.getState().handleUnauthorized())) throw error;
    return requestOnce<T>(path, init);
  }
}

/** Authenticated Workflow gateway call with the 401 renew-and-retry; shared by the monitoring client. */
export const workflowRequest = request;

const REQUEST_TIMEOUT_MS = 15_000;
// Above the gateway's 80 s generate limit (workflow-service 65 s, ai-service 60 s), so the server answers first.
const GENERATE_TIMEOUT_MS = 85_000;

async function requestOnce<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${authToken()}`);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (error) {
    // A client-side timeout is reported as 504 so callers (e.g. AI generation) can say "took too long".
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new WorkflowApiError(timedOut ? 504 : 0, tr('msg.workflow_service_is_temporarily_unavailable'));
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WorkflowApiError(502, tr('msg.workflow_service_returned_an_invalid_response'));
  }

  if (!response.ok) {
    const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    const message = response.status === 429
      ? tr('msg.rate_limited')
      : typeof envelope?.message === 'string'
      ? envelope.message
      : response.status === 401
        ? tr('msg.your_session_has_expired_sign_in_again')
        : response.status >= 500
          ? tr('msg.workflow_service_is_temporarily_unavailable')
          : tr('msg.the_workflow_request_could_not_be_completed');
    // Validation errors carry the reason in details[]; show the first one instead of a bare "invalid".
    const firstDetail = response.status === 400 && Array.isArray(envelope?.details) && isRecord(envelope.details[0])
      ? envelope.details[0].message
      : undefined;
    const details = response.status === 400 && Array.isArray(envelope?.details)
      ? envelope.details.filter(isRecord).map((item) => ({
        ...(typeof item.field === 'string' ? { field: item.field } : {}),
        ...(typeof item.message === 'string' ? { message: item.message } : {}),
      }))
      : [];
    throw new WorkflowApiError(response.status, typeof firstDetail === 'string' && firstDetail ? `${message}: ${firstDetail}` : message, details);
  }

  return payload as T;
}

const WORKSPACE_CACHE_MS = 10_000;
let workspaceCache: { at: number; promise: Promise<WorkspaceSummary[]> } | null = null;

/** Workspace list shared by every workflow call within a short window (dedupes bursts, avoids 429). */
function loadWorkspaces(): Promise<WorkspaceSummary[]> {
  const now = Date.now();
  if (workspaceCache && now - workspaceCache.at < WORKSPACE_CACHE_MS) return workspaceCache.promise;
  const promise = fetchWorkspaces();
  workspaceCache = { at: now, promise };
  promise.catch(() => {
    if (workspaceCache?.promise === promise) workspaceCache = null;
  });
  return promise;
}

export function resetWorkflowWorkspaceCache(): void {
  workspaceCache = null;
}

async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  const page = await request<Page<WorkspaceSummary>>(
    `/api/v1/workspaces?page=0&size=${PAGE_SIZE}&sort=name&direction=asc`,
  );
  if (!Array.isArray(page.items)) throw new WorkflowApiError(502, tr('msg.workspace_service_returned_an_invalid_response'));
  return page.items.filter((item) => typeof item?.id === 'string' && typeof item.name === 'string');
}

export async function getActiveWorkflowWorkspaceId(): Promise<string> {
  const workspaces = await loadWorkspaces();
  if (workspaces.length === 0) {
    throw new WorkflowApiError(409, tr('msg.create_or_join_a_workspace_before_using'));
  }

  const selectedId = typeof localStorage === 'undefined'
    ? null
    : localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  const active = workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0];
  if (!selectedId || !workspaces.some((workspace) => workspace.id === selectedId)) {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, active.id);
  }
  return active.id;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeStatus(value: unknown): WorkflowStatus {
  if (value === 'DRAFT' || value === 'PUBLISHED' || value === 'PAUSED') return value;
  throw new WorkflowApiError(502, tr('msg.workflow_service_returned_an_unknown_workflow_status'));
}

export type GenerationResponse =
  | { status: 'ready'; name: string; definition: unknown; layout: Record<string, { x: number; y: number }> }
  | { status: 'needs_input'; questions: Array<{ code: string; field: string }> }
  | { status: 'unsupported'; reasons: Array<{ code: string }> };

function layoutPosition(entry: unknown): { x: number; y: number } | undefined {
  if (!isRecord(entry)) return undefined;
  if (typeof entry.x === 'number' && typeof entry.y === 'number') {
    return { x: entry.x, y: entry.y };
  }
  const position = isRecord(entry.position) ? entry.position : undefined;
  if (position && typeof position.x === 'number' && typeof position.y === 'number') {
    return { x: position.x, y: position.y };
  }
  return undefined;
}

function layoutName(entry: unknown, fallback: string): string {
  return isRecord(entry) && typeof entry.name === 'string' ? entry.name : fallback;
}

export function definitionToCanvas(
  definition: unknown,
  layout: Record<string, unknown>,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const source = isRecord(definition) ? definition : {};
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes: WorkflowNode[] = rawNodes.flatMap((rawNode): WorkflowNode[] => {
    if (!isRecord(rawNode) || typeof rawNode.id !== 'string' || typeof rawNode.type !== 'string') return [];
    const position = layoutPosition(layout[rawNode.id]);
    return [{
      id: rawNode.id,
      type: rawNode.type,
      name: layoutName(layout[rawNode.id], rawNode.id),
      config: isRecord(rawNode.config) ? rawNode.config : {},
      ...(position ? { position } : {}),
    }];
  });
  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const edges: WorkflowEdge[] = rawEdges.flatMap((rawEdge): WorkflowEdge[] => {
    if (!isRecord(rawEdge) || typeof rawEdge.id !== 'string' || typeof rawEdge.source !== 'string' || typeof rawEdge.target !== 'string') return [];
    return [{
      id: rawEdge.id,
      source: rawEdge.source,
      target: rawEdge.target,
      ...(typeof rawEdge.sourcePort === 'string' ? { sourcePort: rawEdge.sourcePort } : {}),
    }];
  });
  return { nodes, edges };
}

function mapSummary(summary: WorkflowSummaryV1, workspaceId: string): WorkflowDefinition {
  if (!summary || typeof summary.workflowId !== 'string' || typeof summary.name !== 'string') {
    throw new WorkflowApiError(502, tr('msg.workflow_service_returned_an_invalid_workflow'));
  }
  return {
    id: summary.workflowId,
    workspaceId,
    name: summary.name,
    description: typeof summary.description === 'string' ? summary.description : undefined,
    status: safeStatus(summary.status),
    version: 1,
    triggerType: primaryTrigger(summary.triggerTypes) ?? 'trigger.manual',
    ...(Array.isArray(summary.triggerTypes) ? { triggerTypes: summary.triggerTypes } : {}),
    nodes: [],
    edges: [],
    createdAt: safeString(summary.createdAt),
    updatedAt: safeString(summary.updatedAt, safeString(summary.createdAt)),
    ...(typeof summary.publishedAt === 'string' ? { publishedAt: summary.publishedAt } : {}),
    ownerName: '',
  };
}

function mapDetail(detail: WorkflowDetailV1, workspaceId: string): WorkflowDefinition {
  const workflow = mapSummary(detail, workspaceId);
  const editorState = isRecord(detail.editorState) ? detail.editorState : {};
  const editorNodes = isRecord(editorState.nodes) ? editorState.nodes : {};
  const { nodes, edges } = definitionToCanvas(detail.definition, editorNodes);
  const triggerTypes = nodes.filter((node) => node.type.startsWith('trigger.')).map((node) => node.type);
  return {
    ...workflow,
    triggerType: primaryTrigger(triggerTypes) ?? 'trigger.manual',
    triggerTypes,
    nodes,
    edges,
  };
}

export function serializeWorkflowDraft(workflow: WorkflowDefinition): {
  name: string;
  description?: string;
  definition: WorkflowDefinitionV1;
  editorState: { nodes: Record<string, { name: string; position: { x: number; y: number } }> };
} {
  return {
    name: workflow.name,
    ...(workflow.description ? { description: workflow.description } : {}),
    definition: {
      schemaVersion: '1.0',
      nodes: workflow.nodes.map((node) => ({ id: node.id, type: node.type, config: node.config ?? {} })),
      edges: workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
      })),
      variables: {},
    },
    editorState: {
      nodes: Object.fromEntries(workflow.nodes.map((node) => [node.id, {
        name: node.name,
        position: node.position ?? { x: 250, y: 150 },
      }])),
    },
  };
}

export const workflowV1Api = {
  async getWorkflows(workspaceId?: string): Promise<WorkflowDefinition[]> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const items: WorkflowSummaryV1[] = [];
    for (let pageNumber = 0; ; pageNumber += 1) {
      const page = await request<Page<WorkflowSummaryV1>>(
        `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows?page=${pageNumber}&size=${PAGE_SIZE}`,
      );
      if (!Array.isArray(page.items)) throw new WorkflowApiError(502, tr('msg.workflow_service_returned_an_invalid_list'));
      items.push(...page.items);
      if (items.length >= page.totalElements || page.items.length === 0) break;
    }
    return items.map((item) => mapSummary(item, activeWorkspaceId));
  },

  async getWorkflow(id: string, workspaceId?: string): Promise<WorkflowDefinition | null> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    try {
      const path = `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}`;
      const cached = detailCache.get(path);
      let promise: Promise<WorkflowDetailV1>;
      if (cached && Date.now() - cached.at < DETAIL_CACHE_MS) {
        promise = cached.promise;
      } else {
        promise = requestOnce<WorkflowDetailV1>(path);
        detailCache.set(path, { at: Date.now(), promise });
        promise.catch(() => detailCache.delete(path));
      }
      return mapDetail(await promise, activeWorkspaceId);
    } catch (error) {
      if (error instanceof WorkflowApiError && error.status === 404) return null;
      throw error;
    }
  },

  async listExecutions(workflowId: string, page = 0, size = PAGE_SIZE, workspaceId?: string): Promise<Page<WorkflowExecutionSummaryV1>> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    return request<Page<WorkflowExecutionSummaryV1>>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(workflowId)}/executions?page=${page}&size=${size}`,
    );
  },

  async getExecution(workflowId: string, executionId: string, workspaceId?: string): Promise<WorkflowExecutionDetailV1> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    return request<WorkflowExecutionDetailV1>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}?logPage=0&logSize=100`,
    );
  },

  async createWorkflow(payload: Pick<WorkflowDefinition, 'name'> & Partial<Pick<WorkflowDefinition, 'description'>>, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const created = await request<{ workflowId: string }>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows`,
      { method: 'POST', body: JSON.stringify({ name: payload.name, ...(payload.description ? { description: payload.description } : {}) }) },
    );
    const workflow = await this.getWorkflow(created.workflowId, activeWorkspaceId);
    if (!workflow) throw new WorkflowApiError(502, tr('msg.created_workflow_could_not_be_loaded'));
    return workflow;
  },

  /** Creates a draft workflow holding a ready-made definition + layout (e.g. an assistant proposal); returns its id. */
  async createWorkflowFromDefinition(
    input: { name: string; definition: unknown; layout: Record<string, unknown> },
    workspaceId?: string,
  ): Promise<string> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const base = `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows`;
    const { workflowId } = await request<{ workflowId: string }>(base, {
      method: 'POST',
      body: JSON.stringify({ name: input.name }),
    });
    const { nodes } = definitionToCanvas(input.definition, input.layout);
    await request<unknown>(`${base}/${encodeURIComponent(workflowId)}/draft`, {
      method: 'PUT',
      body: JSON.stringify({
        name: input.name,
        definition: input.definition,
        editorState: {
          nodes: Object.fromEntries(nodes.map((node) => [node.id, { name: node.name, position: node.position ?? { x: 250, y: 150 } }])),
        },
      }),
    });
    return workflowId;
  },

  async updateWorkflow(id: string, updates: Partial<WorkflowDefinition>, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const current = await this.getWorkflow(id, activeWorkspaceId);
    if (!current) throw new WorkflowApiError(404, tr('msg.workflow_not_found'));
    const merged = { ...current, ...updates, id: current.id, workspaceId: activeWorkspaceId };
    const saved = await request<WorkflowDetailV1>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/draft`,
      { method: 'PUT', body: JSON.stringify(serializeWorkflowDraft(merged)) },
    );
    return mapDetail(saved, activeWorkspaceId);
  },

  /**
   * Renames on its own: the server has no rename endpoint, so this re-sends the last SAVED draft (fresh copy,
   * never the unsaved canvas) with the new name. A canvas that fails validation cannot lose the rename.
   */
  async renameWorkflow(id: string, name: string, workspaceId?: string): Promise<WorkflowDefinition> {
    detailCache.clear();
    return this.updateWorkflow(id, { name }, workspaceId);
  },

  async publishWorkflow(id: string, workspaceId?: string): Promise<WorkflowPublication> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const publication = await request<{ webhooks?: WebhookProvisioning[] }>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/publish`,
      { method: 'POST' },
    );
    const workflow = await this.getWorkflow(id, activeWorkspaceId);
    if (!workflow) throw new WorkflowApiError(404, tr('msg.published_workflow_could_not_be_loaded'));
    return { workflow, webhooks: Array.isArray(publication.webhooks) ? publication.webhooks : [] };
  },

  async pauseWorkflow(id: string, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    await request<unknown>(`/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/pause`, { method: 'POST' });
    const workflow = await this.getWorkflow(id, activeWorkspaceId);
    if (!workflow) throw new WorkflowApiError(404, tr('msg.workflow_not_found'));
    return workflow;
  },

  async resumeWorkflow(id: string, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    await request<unknown>(`/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/resume`, { method: 'POST' });
    const workflow = await this.getWorkflow(id, activeWorkspaceId);
    if (!workflow) throw new WorkflowApiError(404, tr('msg.workflow_not_found'));
    return workflow;
  },

  async runWorkflow(id: string, input: Record<string, unknown> = {}, workspaceId?: string): Promise<WorkflowRunReceipt> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    return request<WorkflowRunReceipt>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/executions`,
      { method: 'POST', body: JSON.stringify({ input }) },
    );
  },

  async generateWorkflow(input: { prompt: string; timezone?: string; connections?: Record<string, string>; answers?: Record<string, string> }): Promise<GenerationResponse> {
    const workspaceId = await getActiveWorkflowWorkspaceId();
    return request<GenerationResponse>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflows/generate`, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  },

  async duplicateWorkflow(id: string, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const source = await this.getWorkflow(id, activeWorkspaceId);
    if (!source) throw new WorkflowApiError(404, tr('msg.workflow_not_found'));
    const created = await this.createWorkflow({ name: `${source.name} (Copy)`, description: source.description }, activeWorkspaceId);
    return this.updateWorkflow(created.id, { ...source, id: created.id, name: `${source.name} (Copy)`, status: 'DRAFT' }, activeWorkspaceId);
  },

  async deleteWorkflow(id: string, workspaceId?: string): Promise<void> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    await request<void>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  },
};
