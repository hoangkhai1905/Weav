import type { AxiosRequestConfig } from 'axios';
import { isUuid } from './notification.http.contract';

/** Connections belong to workspace-service; the gateway exposes them under the workspace. */
export function connectionsPath(workspaceId: string): string {
  if (!isUuid(workspaceId)) throw new Error('Invalid workspace id.');
  return `/api/v1/workspaces/${workspaceId}/connections`;
}

function connectionPath(workspaceId: string, connectionId: string): string {
  if (!isUuid(connectionId)) throw new Error('Invalid connection id.');
  return `${connectionsPath(workspaceId)}/${connectionId}`;
}

export function buildConnectionListRequest(
  workspaceId: string,
  signal?: AbortSignal,
): AxiosRequestConfig {
  return { url: connectionsPath(workspaceId), ...(signal ? { signal } : {}) };
}

export function buildConnectionDetailRequest(
  workspaceId: string,
  connectionId: string,
  signal?: AbortSignal,
): AxiosRequestConfig {
  return { url: connectionPath(workspaceId, connectionId), ...(signal ? { signal } : {}) };
}

export function buildTestConnectionRequest(
  workspaceId: string,
  connectionId: string,
): AxiosRequestConfig {
  return { method: 'POST', url: `${connectionPath(workspaceId, connectionId)}/test` };
}

export function buildDisableConnectionRequest(
  workspaceId: string,
  connectionId: string,
): AxiosRequestConfig {
  return { method: 'POST', url: `${connectionPath(workspaceId, connectionId)}/disable` };
}
