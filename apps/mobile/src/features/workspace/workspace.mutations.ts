import type {
  CreateWorkspaceInput,
  PageResult,
  Workspace,
  WorkspaceMember,
} from '../../domain/workspace/workspace.types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateMemberEmail(email: string): string | null {
  const normalized = email.trim();
  if (!normalized) return 'Member email is required.';
  if (normalized.length > 320) return 'Member email must be 320 characters or fewer.';
  if (!EMAIL_PATTERN.test(normalized)) return 'Enter a valid member email.';
  return null;
}

export function canManageWorkspaceMember(
  member: Pick<WorkspaceMember, 'role'> | undefined,
): boolean {
  return member?.role === 'OWNER';
}

export function isWorkspaceMemberMutationScopeCurrent(
  expectedUserId: string,
  expectedWorkspaceId: string,
  currentUserId: string | null,
  currentWorkspaceId: string | null,
  isAuthenticated: boolean,
): boolean {
  return (
    isAuthenticated &&
    currentUserId === expectedUserId &&
    currentWorkspaceId === expectedWorkspaceId
  );
}

export function validateWorkspaceName(
  name: string,
  required: boolean,
): string | null {
  const normalized = name.trim();
  if (required && !normalized) return 'Workspace name is required.';
  if (normalized.length > 255) {
    return 'Workspace name must be 255 characters or fewer.';
  }
  return null;
}

export function createWorkspaceInput(name: string): CreateWorkspaceInput {
  const normalized = name.trim();
  return normalized ? { name: normalized } : {};
}

export function isWorkspaceMutationScopeCurrent(
  expectedUserId: string,
  currentUserId: string | null,
  isAuthenticated: boolean,
): boolean {
  return isAuthenticated && currentUserId === expectedUserId;
}

export function canSubmitWorkspaceMutation(
  isPending: boolean,
  submissionInFlight: boolean,
): boolean {
  return !isPending && !submissionInFlight;
}

export function mergeWorkspaceList(
  workspaces: Workspace[],
  workspace: Workspace,
): Workspace[] {
  const existing = workspaces.some((item) => item.id === workspace.id);
  return existing
    ? workspaces.map((item) => (item.id === workspace.id ? workspace : item))
    : [...workspaces, workspace];
}

export function mergeWorkspacePage(
  page: PageResult<Workspace> | undefined,
  workspace: Workspace,
): PageResult<Workspace> | undefined {
  if (!page) return page;
  const items = mergeWorkspaceList(page.items, workspace);
  return {
    ...page,
    items,
    totalElements: page.totalElements + (items.length > page.items.length ? 1 : 0),
  };
}
