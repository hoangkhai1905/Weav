import type { WorkflowDefinition, WorkflowEdge, WorkflowNode, WorkflowStatus } from '../types/workflow.types';

const ACTIVE_WORKSPACE_KEY = 'weav_active_workspace_id';
const PAGE_SIZE = 100;

export class WorkflowApiError extends Error {
  readonly status: number;

  constructor(
    status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowApiError';
    this.status = status;
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

function apiBaseUrl(): string {
  return (
    import.meta.env.VITE_API_GATEWAY_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

function authToken(): string {
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem('weav_token');
  if (!token) throw new WorkflowApiError(401, 'Sign in to access workflows.');
  return token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${authToken()}`);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    throw new WorkflowApiError(0, 'Workflow service is temporarily unavailable.');
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WorkflowApiError(502, 'Workflow service returned an invalid response.');
  }

  if (!response.ok) {
    const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    const message = typeof envelope?.message === 'string'
      ? envelope.message
      : response.status === 401
        ? 'Your session has expired. Sign in again.'
        : response.status >= 500
          ? 'Workflow service is temporarily unavailable.'
          : 'The workflow request could not be completed.';
    throw new WorkflowApiError(response.status, message);
  }

  return payload as T;
}

async function loadWorkspaces(): Promise<WorkspaceSummary[]> {
  const page = await request<Page<WorkspaceSummary>>(
    `/api/v1/workspaces?page=0&size=${PAGE_SIZE}&sort=name&direction=asc`,
  );
  if (!Array.isArray(page.items)) throw new WorkflowApiError(502, 'Workspace service returned an invalid response.');
  return page.items.filter((item) => typeof item?.id === 'string' && typeof item.name === 'string');
}

export async function getActiveWorkflowWorkspaceId(): Promise<string> {
  const workspaces = await loadWorkspaces();
  if (workspaces.length === 0) {
    throw new WorkflowApiError(409, 'Create or join a workspace before using workflows.');
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
  throw new WorkflowApiError(502, 'Workflow service returned an unknown workflow status.');
}

function mapSummary(summary: WorkflowSummaryV1, workspaceId: string): WorkflowDefinition {
  if (!summary || typeof summary.workflowId !== 'string' || typeof summary.name !== 'string') {
    throw new WorkflowApiError(502, 'Workflow service returned an invalid workflow.');
  }
  return {
    id: summary.workflowId,
    workspaceId,
    name: summary.name,
    description: typeof summary.description === 'string' ? summary.description : undefined,
    status: safeStatus(summary.status),
    version: 1,
    triggerType: 'trigger.manual',
    nodes: [],
    edges: [],
    createdAt: safeString(summary.createdAt),
    updatedAt: safeString(summary.updatedAt, safeString(summary.createdAt)),
    ownerName: '',
  };
}

function mapDetail(detail: WorkflowDetailV1, workspaceId: string): WorkflowDefinition {
  const workflow = mapSummary(detail, workspaceId);
  const definition = isRecord(detail.definition) ? detail.definition : {};
  const editorState = isRecord(detail.editorState) ? detail.editorState : {};
  const editorNodes = isRecord(editorState.nodes) ? editorState.nodes : {};
  const rawNodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const nodes: WorkflowNode[] = rawNodes.flatMap((rawNode): WorkflowNode[] => {
    if (!isRecord(rawNode) || typeof rawNode.id !== 'string' || typeof rawNode.type !== 'string') return [];
    const rawLayout = editorNodes[rawNode.id];
    const layout: Record<string, unknown> = isRecord(rawLayout) ? rawLayout : {};
    const rawPosition = isRecord(layout.position) ? layout.position : undefined;
    const position = rawPosition && typeof rawPosition.x === 'number' && typeof rawPosition.y === 'number'
      ? { x: rawPosition.x, y: rawPosition.y }
      : undefined;
    return [{
      id: rawNode.id,
      type: rawNode.type,
      name: safeString(layout.name, rawNode.id),
      config: isRecord(rawNode.config) ? rawNode.config : {},
      ...(position ? { position } : {}),
    }];
  });
  const rawEdges = Array.isArray(definition.edges) ? definition.edges : [];
  const edges: WorkflowEdge[] = rawEdges.flatMap((rawEdge): WorkflowEdge[] => {
    if (!isRecord(rawEdge) || typeof rawEdge.id !== 'string' || typeof rawEdge.source !== 'string' || typeof rawEdge.target !== 'string') return [];
    return [{
      id: rawEdge.id,
      source: rawEdge.source,
      target: rawEdge.target,
      ...(typeof rawEdge.sourcePort === 'string' ? { sourcePort: rawEdge.sourcePort } : {}),
    }];
  });
  const trigger = nodes.find((node) => node.type.startsWith('trigger.'));
  return {
    ...workflow,
    triggerType: trigger?.type ?? 'trigger.manual',
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
      if (!Array.isArray(page.items)) throw new WorkflowApiError(502, 'Workflow service returned an invalid list.');
      items.push(...page.items);
      if (items.length >= page.totalElements || page.items.length === 0) break;
    }
    return items.map((item) => mapSummary(item, activeWorkspaceId));
  },

  async getWorkflow(id: string, workspaceId?: string): Promise<WorkflowDefinition | null> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    try {
      const detail = await request<WorkflowDetailV1>(
        `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}`,
      );
      return mapDetail(detail, activeWorkspaceId);
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
    if (!workflow) throw new WorkflowApiError(502, 'Created workflow could not be loaded.');
    return workflow;
  },

  async updateWorkflow(id: string, updates: Partial<WorkflowDefinition>, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const current = await this.getWorkflow(id, activeWorkspaceId);
    if (!current) throw new WorkflowApiError(404, 'Workflow not found.');
    const merged = { ...current, ...updates, id: current.id, workspaceId: activeWorkspaceId };
    const saved = await request<WorkflowDetailV1>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/draft`,
      { method: 'PUT', body: JSON.stringify(serializeWorkflowDraft(merged)) },
    );
    return mapDetail(saved, activeWorkspaceId);
  },

  async publishWorkflow(id: string, workspaceId?: string): Promise<WorkflowPublication> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const publication = await request<{ webhooks?: WebhookProvisioning[] }>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/publish`,
      { method: 'POST' },
    );
    const workflow = await this.getWorkflow(id, activeWorkspaceId);
    if (!workflow) throw new WorkflowApiError(404, 'Published workflow could not be loaded.');
    return { workflow, webhooks: Array.isArray(publication.webhooks) ? publication.webhooks : [] };
  },

  async pauseWorkflow(id: string, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    await request<unknown>(`/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/pause`, { method: 'POST' });
    const workflow = await this.getWorkflow(id, activeWorkspaceId);
    if (!workflow) throw new WorkflowApiError(404, 'Workflow not found.');
    return workflow;
  },

  async resumeWorkflow(id: string, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    await request<unknown>(`/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/resume`, { method: 'POST' });
    const workflow = await this.getWorkflow(id, activeWorkspaceId);
    if (!workflow) throw new WorkflowApiError(404, 'Workflow not found.');
    return workflow;
  },

  async runWorkflow(id: string, input: Record<string, unknown> = {}, workspaceId?: string): Promise<WorkflowRunReceipt> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    return request<WorkflowRunReceipt>(
      `/api/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/workflows/${encodeURIComponent(id)}/executions`,
      { method: 'POST', body: JSON.stringify({ input }) },
    );
  },

  async duplicateWorkflow(id: string, workspaceId?: string): Promise<WorkflowDefinition> {
    const activeWorkspaceId = workspaceId ?? await getActiveWorkflowWorkspaceId();
    const source = await this.getWorkflow(id, activeWorkspaceId);
    if (!source) throw new WorkflowApiError(404, 'Workflow not found.');
    const created = await this.createWorkflow({ name: `${source.name} (Copy)`, description: source.description }, activeWorkspaceId);
    return this.updateWorkflow(created.id, { ...source, id: created.id, name: `${source.name} (Copy)`, status: 'DRAFT' }, activeWorkspaceId);
  },

  async deleteWorkflow(): Promise<void> {
    throw new WorkflowApiError(405, 'Workflow Service V1 does not provide a delete endpoint.');
  },
};
