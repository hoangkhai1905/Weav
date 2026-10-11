import type { AxiosRequestConfig } from 'axios';
import type { TemplateListQuery, TemplateScope } from '../../domain/template/template.types';
import { isUuid } from './notification.http.contract';
import { buildPageParams } from './workflow.http.contract';

/** Server limit for a code the user typed (it normalises spaces, case, I/L/O itself). */
export const TEMPLATE_CODE_MAX = 32;

const SCOPES: readonly TemplateScope[] = ['public', 'mine'];

function templatePath(id: string): string {
  if (!isUuid(id)) throw new Error('Invalid template id.');
  return `/api/v1/templates/${id}`;
}

export function buildTemplateListRequest(
  scope: TemplateScope,
  query: TemplateListQuery = {},
  signal?: AbortSignal,
): AxiosRequestConfig {
  if (!SCOPES.includes(scope)) throw new Error('Invalid template scope.');
  const q = query.q?.trim();
  return {
    url: '/api/v1/templates',
    params: { scope, ...(q ? { q } : {}), ...buildPageParams(query) },
    ...(signal ? { signal } : {}),
  };
}

export function buildTemplateDetailRequest(id: string, signal?: AbortSignal): AxiosRequestConfig {
  return { url: templatePath(id), ...(signal ? { signal } : {}) };
}

/** The code goes in the path, so it is trimmed, length-checked and percent-encoded here. */
export function buildTemplateByCodeRequest(code: string, signal?: AbortSignal): AxiosRequestConfig {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (trimmed.length === 0 || trimmed.length > TEMPLATE_CODE_MAX) throw new Error('Invalid template code.');
  return {
    url: `/api/v1/templates/by-code/${encodeURIComponent(trimmed)}`,
    ...(signal ? { signal } : {}),
  };
}

/** Body is `{workspaceId, name?}`; the server answers 201 `{workflowId}`. */
export function buildUseTemplateRequest(
  id: string,
  workspaceId: string,
  name?: string,
): AxiosRequestConfig {
  if (!isUuid(workspaceId)) throw new Error('Invalid workspace id.');
  if (name !== undefined && (name.trim().length === 0 || name.length > 255)) {
    throw new Error('Invalid workflow name.');
  }
  return {
    method: 'POST',
    url: `${templatePath(id)}/use`,
    data: { workspaceId, ...(name !== undefined ? { name } : {}) },
  };
}
