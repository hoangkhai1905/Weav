# W7-A1: invite by email for people without an account (#9)

Status: design approved in chat by K 2026-10-10 (option A, no token); this written spec awaits K's review. Lanes: A1a backend, A1b web. Freeze 2026-10-31; cut line: if A1 is not merged by ~10-18, Batch B is dropped, not the evidence work.

## 1. Goal

A workspace OWNER types an e-mail that has no Weav account. Instead of `USER_NOT_FOUND`, the owner can send an invitation e-mail. The person signs up with that address, verifies it (OTP or Google), opens "Lời mời" and accepts; they become a MEMBER. Existing accounts keep the direct add (`POST /members`, unchanged).

Success: live check with a real Resend e-mail to a fresh `+alias` address: invite -> e-mail received -> sign up -> verify -> accept -> member with default permissions; expired/revoked/unverified cases refused.

## 2. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | No invite token. Acceptance is bound to the invited e-mail: the caller's **verified** e-mail (identity directory) must equal the invitation's canonical e-mail. The e-mail links to `<web>/invitations`, not to a secret URL. | No secret in the broker, the e-mail, logs or browser history; a forwarded e-mail lets nobody else in. |
| D2 | **Mail ownership (K 2026-10-10):** notification-service owns product/notification e-mail (invitations now; monitoring/failure e-mails later). Identity keeps auth e-mail (OTP, password reset) unchanged. Nodes (`email.send` via the user's Gmail) stay in workflow-service. | Auth mail carries live secrets (OTP codes would otherwise be persisted in `notification_deliveries.payload` and the broker) and needs a synchronous, rate-limited send while the user waits; moving the login path before the freeze has no demo value. |
| D3 | notification-service sends SMTP with `nodemailer` (new dependency) and reuses identity's `SMTP_*` variables (host, port, username, password, auth flag, from address, and identity's TLS flag), gated by a new `NOTIFICATION_EMAIL_ENABLED` (default false). | One mail configuration for Gmail (dev) and Resend (demo); SMTP is not "a few lines". |
| D4 | The EMAIL delivery is owned by the inviter (`user_id` = inviter, `destination` = invitee e-mail, linked to the inviter's inbox row). | `notification_deliveries.user_id` is NOT NULL and the invitee has no user id; the inviter seeing "invitation sent to …" is correct. No schema change besides the enum value. |
| D5 | Expiry 7 days, computed on read (no sweeper). Max 50 PENDING per workspace. Resend: once per 10 minutes per invitation. Role on accept: MEMBER with default permissions, same as `AddMemberUseCase`. | Smallest correct rules. |
| D6 | Mobile: handoff note only (`docs/handoff/`), no mobile code. | Partner owns mobile. |

## 3. workspace-service (A1a)

Migration `V8__workspace_invitations.sql`:

```sql
CREATE TABLE workspace_invitations (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  email         varchar(320) NOT NULL,          -- canonical (IdentityEmailNormalizer)
  invited_by    uuid NOT NULL,
  status        varchar(16) NOT NULL CHECK (status IN ('PENDING','ACCEPTED','DECLINED','REVOKED')),
  expires_at    timestamptz NOT NULL,
  last_sent_at  timestamptz NOT NULL,
  responded_at  timestamptz,
  responded_by  uuid,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX workspace_invitations_one_pending
  ON workspace_invitations (workspace_id, email) WHERE status = 'PENDING';
CREATE INDEX workspace_invitations_email_pending
  ON workspace_invitations (email) WHERE status = 'PENDING';
```

"Expired" = `status = 'PENDING' AND expires_at <= now()`; views report it as `EXPIRED`. Creating a new invitation for an e-mail whose PENDING row is expired marks the old row `REVOKED` in the same transaction.

Routes (JWT; all inside the existing workspace lock/transaction pattern):

| Route | Who | Behaviour |
| --- | --- | --- |
| `POST /workspaces/{id}/invitations` `{email}` | OWNER | Canonicalize. If identity finds an ACTIVE account -> `409 USER_EXISTS` (web tells the owner to use the direct add). Inactive account -> `409 USER_INACTIVE`. Already a live PENDING invite -> `409 INVITATION_EXISTS`. 50 pending -> `429 INVITATION_LIMIT`. Else insert, record `workspace.invitation.created`, `201` with the view. |
| `GET /workspaces/{id}/invitations` | OWNER | PENDING (incl. expired) newest first, max 50. |
| `DELETE /workspaces/{id}/invitations/{invId}` | OWNER | PENDING -> REVOKED, `204`; otherwise `409 INVITATION_NOT_PENDING`. |
| `POST /workspaces/{id}/invitations/{invId}/resend` | OWNER | Live PENDING only; `last_sent_at` older than 10 min else `429 INVITATION_RESEND_TOO_SOON`; extends `expires_at` to now + 7 days; records the event again (new event id); `200`. |
| `GET /me/invitations` | any user | Looks up the caller in identity (by user id). Unverified e-mail -> `200 {items: [], emailVerified: false}`. Else live PENDING invitations for that e-mail in non-deleted workspaces: `{id, workspaceId, workspaceName, invitedByName, expiresAt}`. |
| `POST /me/invitations/{invId}/accept` | invitee | Caller's verified canonical e-mail must equal the row's e-mail, else `404` (do not reveal). Unverified -> `409 EMAIL_NOT_VERIFIED`. Expired/REVOKED -> `410 INVITATION_GONE`. Workspace deleted -> `410`. Already a member -> mark ACCEPTED, `200` (idempotent). Else create MEMBER membership + `recordMemberAdded` + cache evict exactly like `AddMemberUseCase`, mark ACCEPTED, `200 {workspaceId}`. |
| `POST /me/invitations/{invId}/decline` | invitee | Same checks; PENDING -> DECLINED, `204`. |

Workspace soft delete (`V7`): pending invitations of a deleted workspace are refused at accept (`410`) and hidden from `/me/invitations`; no extra delete step.

Event `workspace.invitation.created` (v2 envelope via `WorkspaceNotificationRecorder`, recipients `[invitedBy]`), data: `{workspaceName, inviteeEmail, inviterName, expiresAt}`. Add the type to `packages/contracts/events/notification/event-v2.schema.json` + an example.

## 4. identity-service (A1a)

The internal directory user view (`/internal/directory/users…`, `InternalDirectoryController` / `DirectoryUserQueryService`) gains `emailVerified: boolean` (additive). workspace-service `IdentityUserSummary` reads it (missing -> false). No other identity change; OTP and password-reset mail stay as they are.

## 5. notification-service (A1a)

- Prisma migration: add `EMAIL` to `NotificationProvider`; `providerSchema` gains `EMAIL`.
- `EmailProvider implements NotificationProvider`: nodemailer transport from `SMTP_*`; `PROVIDER_DISABLED` (permanent) when `NOTIFICATION_EMAIL_ENABLED` is false; destination must be a plausible e-mail (≤ 320 chars) else `INVALID_DESTINATION`; SMTP 4xx / network errors retryable, 5xx permanent; timeout `NOTIFICATION_TIMEOUT_MS`. Never log the destination or body; log delivery id + error code.
- Catalog: `workspace.invitation.created` -> inbox row for the inviter ("Đã gửi lời mời tới {email}" / "Invitation sent to {email}", target WORKSPACE) **and** one EMAIL delivery to `data.inviteeEmail` linked to that inbox row, idempotent on the existing `(source_event_id, user_id, provider, destination)` key.
- E-mail body: plain text, Vietnamese then English: inviter name, workspace name, "Sign up or sign in with this address, verify it, then open {NOTIFICATION_DETAIL_BASE_URL}/invitations", expiry date. Subject: "Lời mời tham gia “{workspace}” trên Weav / Invitation to join “{workspace}” on Weav". Names are truncated as the catalog already does.
- `.env.example` + compose: pass `SMTP_*` and `NOTIFICATION_EMAIL_ENABLED` to notification-service.

## 6. api-gateway + contracts (A1a)

Gateway routes for the 7 endpoints (`/api/v1/workspaces/:id/invitations…`, `/api/v1/me/invitations…`), same auth/forwarding as the members routes; throttle create + resend (per user). `packages/contracts/http/workspace/openapi.yaml`: new paths and schemas. Contract/e2e tests for the new routes.

## 7. Web (A1b)

- Members tab: on `USER_NOT_FOUND` from add-member, show "Chưa có tài khoản Weav với email này. Gửi lời mời qua email?" with a "Gửi lời mời" button -> `POST invitations`. Map `INVITATION_EXISTS`, `INVITATION_LIMIT`, `USER_EXISTS`.
- Members tab (owner): "Lời mời đang chờ" list: e-mail, sent/expiry, status (Expired badge), Resend, Revoke (confirm).
- New route `/invitations` (signed-in): list from `GET /me/invitations`, Accept / Decline; after accept, switch to the workspace. If `emailVerified: false`: notice + link to Settings e-mail verification (already exists). Sign-in/up redirect back to `/invitations` when it was the target.
- Entry point: a banner on the dashboard when `/me/invitations` is non-empty (one cached query).
- i18n vi/en keys; no hard-coded strings.

## 8. Error handling and security

- Owner checks before any identity call (as `AddMemberUseCase`), so non-owners cannot probe which e-mails have accounts.
- `USER_EXISTS` reveals account existence to an OWNER; the direct add already does (`USER_NOT_FOUND`), so nothing new leaks.
- Accept/decline never reveal invitations of other e-mails (`404`).
- Rate limits: gateway throttle + 50 pending + 10-minute resend.
- No secrets anywhere; e-mail addresses are personal data: not logged by any service.

## 9. Testing

- workspace-service: unit tests for each rule (exists, limit, expiry, resend cooldown, e-mail mismatch, unverified, idempotent accept, deleted workspace); Testcontainers integration test for V8 + accept creating the membership and the outbox event. `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify`.
- identity-service: directory test asserts `emailVerified`.
- notification-service: `EmailProvider` unit tests (disabled, invalid destination, retryable vs permanent, no PII in logs) with a fake transport; catalog test for the new event (inbox + EMAIL delivery); runtime integration list updated.
- gateway: e2e for the 7 routes.
- web: Playwright with `page.route` stubs for invite/resend/revoke/accept/unverified.
- Live (Neon `dev-k`, after the second-stack check; K signs in): real Resend e-mail to a new `+alias`.

## 10. Out of scope

Invite tokens/links that auto-join; inviting with a role other than MEMBER; moving OTP/password-reset mail to notification-service; e-mail monitoring alerts (now possible via the EMAIL provider; candidate after the freeze); mobile screens.
