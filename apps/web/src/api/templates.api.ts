import { getActiveWorkflowWorkspaceId, WorkflowApiError, workflowRequest } from './workflow-v1.api';
import { tr } from '../lib/i18n/tr';

/** Shared workflow templates (Workflow Service through the Gateway). Shapes mirror the W6-C API contract. */

export type TemplateVisibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
export type TemplateScope = 'public' | 'workspace' | 'mine';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  authorName: string | null;
  nodeTypes: string[];
  visibility: TemplateVisibility;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  owned: boolean;
  /** Only the owner receives the code, and only on detail responses. */
  shareCode?: string;
}

export interface TemplateDefinition {
  nodes?: Array<{ id: string; type: string }>;
}

export interface TemplateDetail extends TemplateSummary {
  definition: TemplateDefinition;
  editorState: Record<string, unknown> | null;
  workspaceId?: string;
  sourceWorkflowId?: string;
}

export interface TemplatePreview {
  definition: TemplateDefinition;
  editorState: Record<string, unknown> | null;
  removedFields: Array<{ nodeId: string; field: string }>;
  warnings: Array<{ nodeId: string; field: string; reason: 'EMAIL' | 'TOKEN' }>;
  existing: TemplateDetail | null;
}

export interface TemplatePage {
  items: TemplateSummary[];
  page: number;
  size: number;
  totalElements: number;
}

export interface ShareInput {
  name: string;
  description?: string;
  authorName?: string;
  visibility: TemplateVisibility;
}

const wfBase = (workspaceId: string, workflowId: string) =>
  `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}`;

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function invalid(): WorkflowApiError {
  return new WorkflowApiError(502, tr('msg.workflow_service_returned_an_invalid_response'));
}

export async function listTemplates(
  scope: TemplateScope,
  options: { workspaceId?: string; q?: string; page?: number; size?: number } = {},
): Promise<TemplatePage> {
  const workspaceId = scope === 'workspace' ? options.workspaceId ?? (await getActiveWorkflowWorkspaceId()) : undefined;
  const result = await workflowRequest<TemplatePage>(
    `/api/v1/templates${query({ scope, workspaceId, q: options.q?.trim(), page: options.page ?? 0, size: options.size ?? 12 })}`,
  );
  if (!result || !Array.isArray(result.items)) throw invalid();
  return result;
}

export const getTemplate = (id: string) =>
  workflowRequest<TemplateDetail>(`/api/v1/templates/${encodeURIComponent(id)}`);

/** The server normalises the code (case, spaces, dashes), so it is sent as typed. */
export const getTemplateByCode = (code: string) =>
  workflowRequest<TemplateDetail>(`/api/v1/templates/by-code/${encodeURIComponent(code.trim())}`);

export async function previewShare(workflowId: string, workspaceId?: string): Promise<TemplatePreview> {
  const ws = workspaceId ?? (await getActiveWorkflowWorkspaceId());
  const result = await workflowRequest<TemplatePreview>(`${wfBase(ws, workflowId)}/template/preview`, { method: 'POST' });
  if (!result || !Array.isArray(result.removedFields) || !Array.isArray(result.warnings)) throw invalid();
  return result;
}

export async function shareWorkflow(workflowId: string, input: ShareInput, workspaceId?: string): Promise<TemplateDetail> {
  const ws = workspaceId ?? (await getActiveWorkflowWorkspaceId());
  return workflowRequest<TemplateDetail>(`${wfBase(ws, workflowId)}/template`, { method: 'PUT', body: JSON.stringify(input) });
}

export const updateTemplate = (
  id: string,
  patch: { name?: string; description?: string; visibility?: TemplateVisibility },
) => workflowRequest<TemplateDetail>(`/api/v1/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteTemplate = (id: string) =>
  workflowRequest<void>(`/api/v1/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Copies the template into a workspace as a draft and returns the new workflow id. */
export async function copyTemplateToWorkspace(id: string, name?: string, workspaceId?: string): Promise<string> {
  const ws = workspaceId ?? (await getActiveWorkflowWorkspaceId());
  const result = await workflowRequest<{ workflowId: string }>(`/api/v1/templates/${encodeURIComponent(id)}/use`, {
    method: 'POST',
    body: JSON.stringify({ workspaceId: ws, ...(name ? { name } : {}) }),
  });
  if (typeof result?.workflowId !== 'string') throw invalid();
  return result.workflowId;
}
