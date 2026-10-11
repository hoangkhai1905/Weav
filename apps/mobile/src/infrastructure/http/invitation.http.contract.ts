import type { AxiosRequestConfig } from 'axios';
import { isUuid } from './notification.http.contract';
import { buildVerifyOtpRequest } from './password-recovery.http.contract';

export const MY_INVITATIONS_PATH = '/api/v1/invitations';
export const OTP_REQUEST_PATH = '/api/auth/otp/request';
export const INVITE_EMAIL_MAX = 320;
export const EMAIL_CODE_LENGTH = 6;

function ownerPath(workspaceId: string): string {
  if (!isUuid(workspaceId)) throw new Error('Invalid workspace id.');
  return `/api/v1/workspaces/${workspaceId}/invitations`;
}

function ownerItemPath(workspaceId: string, invitationId: string): string {
  if (!isUuid(invitationId)) throw new Error('Invalid invitation id.');
  return `${ownerPath(workspaceId)}/${invitationId}`;
}

function myItemPath(invitationId: string): string {
  if (!isUuid(invitationId)) throw new Error('Invalid invitation id.');
  return `${MY_INVITATIONS_PATH}/${invitationId}`;
}

const withSignal = (config: AxiosRequestConfig, signal?: AbortSignal): AxiosRequestConfig =>
  signal ? { ...config, signal } : config;

/** Body is `{email}`, trimmed; the server answers 201 with the invitation. */
export function buildCreateInvitationRequest(
  workspaceId: string,
  email: string,
  signal?: AbortSignal,
): AxiosRequestConfig {
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (trimmed.length === 0 || trimmed.length > INVITE_EMAIL_MAX) throw new Error('Invalid email.');
  return withSignal({ method: 'POST', url: ownerPath(workspaceId), data: { email: trimmed } }, signal);
}

export function buildOwnerInvitationsRequest(workspaceId: string, signal?: AbortSignal): AxiosRequestConfig {
  return withSignal({ url: ownerPath(workspaceId) }, signal);
}

export function buildRevokeInvitationRequest(
  workspaceId: string,
  invitationId: string,
  signal?: AbortSignal,
): AxiosRequestConfig {
  return withSignal({ method: 'DELETE', url: ownerItemPath(workspaceId, invitationId) }, signal);
}

export function buildResendInvitationRequest(
  workspaceId: string,
  invitationId: string,
  signal?: AbortSignal,
): AxiosRequestConfig {
  return withSignal({ method: 'POST', url: `${ownerItemPath(workspaceId, invitationId)}/resend` }, signal);
}

export function buildMyInvitationsRequest(signal?: AbortSignal): AxiosRequestConfig {
  return withSignal({ url: MY_INVITATIONS_PATH }, signal);
}

export function buildAcceptInvitationRequest(invitationId: string, signal?: AbortSignal): AxiosRequestConfig {
  return withSignal({ method: 'POST', url: `${myItemPath(invitationId)}/accept` }, signal);
}

export function buildDeclineInvitationRequest(invitationId: string, signal?: AbortSignal): AxiosRequestConfig {
  return withSignal({ method: 'POST', url: `${myItemPath(invitationId)}/decline` }, signal);
}

/** The signed-in user asks for a code for their own address (the server finds it from the token). */
export function buildEmailVerificationRequest(signal?: AbortSignal): AxiosRequestConfig {
  return withSignal({ method: 'POST', url: OTP_REQUEST_PATH, data: { purpose: 'EMAIL_VERIFICATION' } }, signal);
}

/** Same endpoint as the password-reset check; the answer's `purpose` tells them apart. */
export function buildVerifyEmailRequest(
  challengeId: string,
  code: string,
  signal?: AbortSignal,
): AxiosRequestConfig {
  if (typeof challengeId !== 'string' || challengeId.length === 0) throw new Error('Invalid challenge id.');
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid verification code.');
  return withSignal(buildVerifyOtpRequest(challengeId, code), signal);
}
