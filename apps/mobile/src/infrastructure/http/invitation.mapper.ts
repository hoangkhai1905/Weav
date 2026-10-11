import type {
  EmailVerificationReceipt,
  MyInvitation,
  MyInvitationList,
  OwnerInvitation,
} from '../../domain/workspace/workspace.types';
import { arr, bool, int, invalid, oneOf, rec, str, strOrNull } from './mapper-utils';

const STATUSES = ['PENDING', 'EXPIRED', 'ACCEPTED', 'DECLINED', 'REVOKED'] as const;

export function mapOwnerInvitation(value: unknown): OwnerInvitation {
  const r = rec(value, 'invitation');
  return {
    id: str(r, 'id', 'invitation'),
    workspaceId: str(r, 'workspaceId', 'invitation'),
    email: str(r, 'email', 'invitation'),
    status: oneOf(r, 'status', STATUSES, 'invitation'),
    invitedBy: str(r, 'invitedBy', 'invitation'),
    createdAt: str(r, 'createdAt', 'invitation'),
    expiresAt: str(r, 'expiresAt', 'invitation'),
    lastSentAt: strOrNull(r, 'lastSentAt', 'invitation'),
  };
}

/** `{ items }`, not a bare array. */
export function mapOwnerInvitationList(value: unknown): OwnerInvitation[] {
  return arr(rec(value, 'invitations'), 'items', 'invitations').map(mapOwnerInvitation);
}

function mapMyInvitation(value: unknown): MyInvitation {
  const r = rec(value, 'myInvitation');
  return {
    id: str(r, 'id', 'myInvitation'),
    workspaceId: str(r, 'workspaceId', 'myInvitation'),
    workspaceName: str(r, 'workspaceName', 'myInvitation'),
    invitedByName: str(r, 'invitedByName', 'myInvitation'),
    expiresAt: str(r, 'expiresAt', 'myInvitation'),
  };
}

export function mapMyInvitationList(value: unknown): MyInvitationList {
  const r = rec(value, 'myInvitations');
  return {
    items: arr(r, 'items', 'myInvitations').map(mapMyInvitation),
    emailVerified: bool(r, 'emailVerified', 'myInvitations'),
  };
}

export function mapAcceptedInvitation(value: unknown): { workspaceId: string } {
  return { workspaceId: str(rec(value, 'acceptedInvitation'), 'workspaceId', 'acceptedInvitation') };
}

export function mapEmailVerificationReceipt(value: unknown): EmailVerificationReceipt {
  const r = rec(value, 'emailVerification');
  const challengeId = str(r, 'challengeId', 'emailVerification');
  if (challengeId.length === 0) invalid('emailVerification.challengeId');
  return { challengeId, expiresIn: int(r, 'expiresIn', 'emailVerification') };
}

/** The same endpoint also answers password-reset checks; anything but EMAIL_VERIFICATION is rejected. */
export function mapEmailVerified(value: unknown): void {
  oneOf(rec(value, 'emailVerified'), 'purpose', ['EMAIL_VERIFICATION'] as const, 'emailVerified');
}
