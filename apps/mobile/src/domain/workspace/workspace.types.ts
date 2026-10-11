export type WorkspaceRole = 'OWNER' | 'MEMBER';

export interface PageResult<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface WorkspaceListQuery {
  search?: string;
  role?: WorkspaceRole;
  page?: number;
  size?: number;
  sort?: 'name' | 'createdAt' | 'updatedAt';
  direction?: 'asc' | 'desc';
}

export interface WorkspaceMemberListQuery {
  search?: string;
  role?: WorkspaceRole;
  canPublishWorkflow?: boolean;
  canManageWorkflowState?: boolean;
  page?: number;
  size?: number;
  sort?: 'displayName' | 'joinedAt' | 'role';
  direction?: 'asc' | 'desc';
}

export interface WorkspaceMember {
  id: string;
  name: string;
  displayName: string | null;
  email: string;
  role: WorkspaceRole;
  canPublishWorkflow: boolean;
  canManageWorkflowState: boolean;
  active: boolean;
  joinedAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  name?: string | null;
}

export interface RenameWorkspaceInput {
  name: string;
}

export interface AddWorkspaceMemberInput {
  email: string;
}

export interface UpdateWorkspaceMemberPermissionsInput {
  canPublishWorkflow: boolean;
  canManageWorkflowState: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
  ownerName?: string;
  memberCount?: number;
}

export type InvitationStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';

/** An invitation as the workspace owner sees it. */
export interface OwnerInvitation {
  id: string;
  workspaceId: string;
  email: string;
  status: InvitationStatus;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  lastSentAt: string | null;
}

/** An invitation as the invitee sees it (never carries another address). */
export interface MyInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  invitedByName: string;
  expiresAt: string;
}

/** `emailVerified: false` means the server hid the list until the address is verified. */
export interface MyInvitationList {
  items: MyInvitation[];
  emailVerified: boolean;
}

export interface EmailVerificationReceipt {
  challengeId: string;
  expiresIn: number;
}

export interface WorkspaceRepository {
  listWorkspaces(
    query?: WorkspaceListQuery,
    signal?: AbortSignal,
  ): Promise<PageResult<Workspace>>;
  getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<Workspace>;
  /** Owner only. `name` must match the workspace name (trimmed, case-insensitive) or the server answers 400. */
  deleteWorkspace(workspaceId: string, name: string, signal?: AbortSignal): Promise<void>;
  createWorkspace(
    input: CreateWorkspaceInput,
    signal?: AbortSignal,
  ): Promise<Workspace>;
  renameWorkspace(
    workspaceId: string,
    input: RenameWorkspaceInput,
    signal?: AbortSignal,
  ): Promise<Workspace>;
  getMembers(
    workspaceId: string,
    query?: WorkspaceMemberListQuery,
    signal?: AbortSignal,
  ): Promise<PageResult<WorkspaceMember>>;
  addMember(
    workspaceId: string,
    input: AddWorkspaceMemberInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceMember>;
  updateMemberPermissions(
    workspaceId: string,
    userId: string,
    input: UpdateWorkspaceMemberPermissionsInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceMember>;
  removeMember(
    workspaceId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  leaveWorkspace(workspaceId: string, signal?: AbortSignal): Promise<void>;
  /** Owner only. Invites an address that has no Weav account yet. */
  createInvitation(
    workspaceId: string,
    input: AddWorkspaceMemberInput,
    signal?: AbortSignal,
  ): Promise<OwnerInvitation>;
  /** Owner only. Pending and expired invitations, newest first. */
  listInvitations(workspaceId: string, signal?: AbortSignal): Promise<OwnerInvitation[]>;
  revokeInvitation(workspaceId: string, invitationId: string, signal?: AbortSignal): Promise<void>;
  /** Allowed once per 10 minutes (429 INVITATION_RESEND_TOO_SOON). */
  resendInvitation(
    workspaceId: string,
    invitationId: string,
    signal?: AbortSignal,
  ): Promise<OwnerInvitation>;
  listMyInvitations(signal?: AbortSignal): Promise<MyInvitationList>;
  /** Joins as MEMBER; calling it twice is fine. */
  acceptInvitation(invitationId: string, signal?: AbortSignal): Promise<{ workspaceId: string }>;
  declineInvitation(invitationId: string, signal?: AbortSignal): Promise<void>;
  /** Sends a 6-digit code to the signed-in user's own address. */
  requestEmailVerification(signal?: AbortSignal): Promise<EmailVerificationReceipt>;
  verifyEmail(challengeId: string, code: string, signal?: AbortSignal): Promise<void>;
}
