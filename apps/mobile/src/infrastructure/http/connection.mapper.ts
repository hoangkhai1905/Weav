import type {
  ConnectionItem,
  ConnectionTestOutcome,
} from '../../domain/connection/connection.types';
import { bool, invalid, oneOf, rec, str, strOrNull } from './mapper-utils';

const PROVIDERS = [
  'GMAIL',
  'GOOGLE_SHEETS',
  'GOOGLE_CALENDAR',
  'GOOGLE_DRIVE',
  'TELEGRAM',
  'HTTP',
] as const;
const AUTH_TYPES = ['NONE', 'TOKEN', 'API_KEY', 'BASIC', 'OAUTH2'] as const;
const STATUSES = ['ACTIVE', 'INVALID', 'DISABLED'] as const;
const OUTCOMES = ['VERIFIED', 'AUTH_INVALID', 'DEPENDENCY_FAILURE'] as const;

export function mapConnection(value: unknown): ConnectionItem {
  const r = rec(value, 'connection');
  const config = r.config === null || r.config === undefined ? null : rec(r.config, 'connection.config');
  return {
    id: str(r, 'id', 'connection'),
    workspaceId: str(r, 'workspaceId', 'connection'),
    createdBy: str(r, 'createdBy', 'connection'),
    name: str(r, 'name', 'connection'),
    provider: oneOf(r, 'provider', PROVIDERS, 'connection'),
    authType: oneOf(r, 'authType', AUTH_TYPES, 'connection'),
    status: oneOf(r, 'status', STATUSES, 'connection'),
    config,
    hasCredential: bool(r, 'hasCredential', 'connection'),
    credentialExpiresAt: strOrNull(r, 'credentialExpiresAt', 'connection'),
    lastVerifiedAt: strOrNull(r, 'lastVerifiedAt', 'connection'),
    canManage: bool(r, 'canManage', 'connection'),
    canAttach: bool(r, 'canAttach', 'connection'),
    createdAt: str(r, 'createdAt', 'connection'),
    updatedAt: str(r, 'updatedAt', 'connection'),
  };
}

/** The list endpoint returns a bare array. */
export function mapConnectionList(value: unknown): ConnectionItem[] {
  if (!Array.isArray(value)) invalid('connections');
  return value.map(mapConnection);
}

export function mapConnectionTestOutcome(value: unknown): ConnectionTestOutcome {
  return oneOf(rec(value, 'connectionTest'), 'outcome', OUTCOMES, 'connectionTest');
}
